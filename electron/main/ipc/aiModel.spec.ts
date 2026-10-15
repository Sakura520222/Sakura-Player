import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  complete: vi.fn(),
  test: vi.fn(),
  visible: true,
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler),
  },
  BrowserWindow: { fromWebContents: () => ({ isVisible: () => mocks.visible }) },
}));
vi.mock("@main/services/ai", () => ({ completeAi: mocks.complete, testAiConnection: mocks.test }));
vi.mock("@main/services/ai/model", () => ({
  listAiModels: vi.fn(),
  removeAiModel: vi.fn(),
  saveAiModel: vi.fn(),
  setActiveAiModel: vi.fn(),
}));

import { registerAiModelIpc } from "./aiModel";

let nextSender = 0;
const createEvent = () => {
  const frame = {};
  const sender = Object.assign(new EventEmitter(), {
    id: ++nextSender,
    mainFrame: frame,
    isDestroyed: () => false,
    send: vi.fn(),
  });
  return { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent & {
    sender: WebContents & EventEmitter & { send: ReturnType<typeof vi.fn> };
  };
};
const invoke = (channel: string, ...args: unknown[]) =>
  mocks.handlers.get(`aiModel:${channel}`)!(...args) as Promise<unknown>;
const untilAbort = (_request: unknown, signal: AbortSignal) =>
  new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.visible = true;
  registerAiModelIpc();
  mocks.complete.mockImplementation(untilAbort);
  mocks.test.mockImplementation(untilAbort);
});
afterEach(() => vi.useRealTimers());

describe("AI 请求生命周期与窗口隔离", () => {
  it("增量发送失败时中断任务，计时器不能向主进程抛出未捕获异常", async () => {
    vi.useFakeTimers();
    const event = createEvent();
    event.sender.send.mockImplementation(() => {
      throw new Error("frame disposed");
    });
    mocks.complete.mockImplementation((request, signal, onDelta) => {
      onDelta("partial");
      return untilAbort(request, signal);
    });
    const task = invoke("stream", event, { requestId: "send-error" });
    let timerError: unknown;
    try {
      await vi.advanceTimersByTimeAsync(50);
    } catch (error) {
      timerError = error;
    }
    await invoke("cancel", event, "send-error");
    expect(await task).toEqual({ status: "cancelled" });
    expect(timerError).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("只允许请求所属窗口取消，结束后解除所有生命周期监听", async () => {
    const owner = createEvent();
    const other = createEvent();
    const task = invoke("complete", owner, { requestId: "one" });
    expect(await invoke("cancel", other, "one")).toBe(false);
    expect(await invoke("cancel", owner, "one")).toBe(true);
    expect(await task).toEqual({ status: "cancelled" });
    expect(owner.sender.listenerCount("destroyed")).toBe(0);
    expect(owner.sender.listenerCount("did-start-navigation")).toBe(0);
    expect(await invoke("cancel", owner, "one")).toBe(false);
  });

  it("重复 ID 不会覆盖原请求，其他窗口可独立使用同一 ID", async () => {
    const first = createEvent();
    const second = createEvent();
    const a = invoke("complete", first, { requestId: "same" });
    expect(await invoke("complete", first, { requestId: "same" })).toMatchObject({
      status: "error",
    });
    const b = invoke("complete", second, { requestId: "same" });
    await invoke("cancel", first, "same");
    await invoke("cancel", second, "same");
    expect(await a).toEqual({ status: "cancelled" });
    expect(await b).toEqual({ status: "cancelled" });
  });

  it.each(["destroyed", "render-process-gone", "did-start-navigation"])(
    "%s 中断当前窗口任务",
    async (name) => {
      const event = createEvent();
      const task = invoke("complete", event, { requestId: "lifecycle" });
      event.sender.emit(name, {}, "file://app", false, true);
      expect(await task).toEqual({ status: "cancelled" });
      expect(event.sender.listenerCount("render-process-gone")).toBe(0);
    },
  );

  it("页面内部跳转和子框架导航不取消主框架请求", async () => {
    const event = createEvent();
    const task = invoke("complete", event, { requestId: "navigation" });
    event.sender.emit("did-start-navigation", {}, "file://app#settings", true, true);
    event.sender.emit("did-start-navigation", {}, "https://frame", false, false);
    expect(await invoke("cancel", event, "navigation")).toBe(true);
    await task;
  });

  it("未完成请求有总量上限，释放后可以继续调用", async () => {
    const event = createEvent();
    const tasks = Array.from({ length: 8 }, (_, index) =>
      invoke("complete", event, { requestId: `limit-${index}` }),
    );
    expect(await invoke("complete", event, { requestId: "over-limit" })).toMatchObject({
      status: "error",
    });
    event.sender.emit("destroyed");
    await Promise.all(tasks);
    mocks.complete.mockResolvedValue({ text: "OK" });
    expect(await invoke("complete", createEvent(), { requestId: "after-release" })).toEqual({
      status: "completed",
      data: { text: "OK" },
    });
  });

  it("非法请求 ID 或子框架请求不会调用模型", async () => {
    const event = createEvent();
    expect(await invoke("complete", event, { requestId: "../bad" })).toMatchObject({
      status: "error",
    });
    expect(
      await invoke("complete", { ...event, senderFrame: {} }, { requestId: "frame" }),
    ).toMatchObject({ status: "error" });
    expect(await invoke("complete", event, null)).toMatchObject({ status: "error" });
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("连接测试复用取消链路，普通服务错误转为明确失败状态", async () => {
    const event = createEvent();
    const task = invoke("test", event, { requestId: "test", config: {} });
    await invoke("cancel", event, "test");
    expect(await task).toEqual({ status: "cancelled" });
    mocks.complete.mockRejectedValue(new Error("认证失败"));
    expect(await invoke("complete", event, { requestId: "failed" })).toEqual({
      status: "error",
      error: "认证失败",
    });
  });

  it("流式文本合并发送；隐藏期间不推送，恢复后补发且结果完整", async () => {
    vi.useFakeTimers();
    const event = createEvent();
    let emit!: (text: string) => void;
    let finish!: (value: unknown) => void;
    mocks.complete.mockImplementation((_request, _signal, onDelta) => {
      emit = onDelta;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const task = invoke("stream", event, { requestId: "stream" });
    emit("你");
    emit("好");
    expect(event.sender.send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(event.sender.send).toHaveBeenLastCalledWith("aiModel:delta:stream", "你好");
    mocks.visible = false;
    emit(" hidden");
    await vi.advanceTimersByTimeAsync(100);
    expect(event.sender.send).toHaveBeenCalledTimes(1);
    mocks.visible = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(event.sender.send).toHaveBeenLastCalledWith("aiModel:delta:stream", " hidden");
    emit(" final");
    finish({ text: "你好 hidden final" });
    expect(await task).toEqual({ status: "completed", data: { text: "你好 hidden final" } });
    expect(event.sender.send).toHaveBeenLastCalledWith("aiModel:delta:stream", " final");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("取消后不再发送已缓冲的文本且计时器被释放", async () => {
    vi.useFakeTimers();
    const event = createEvent();
    mocks.complete.mockImplementation((request, signal, onDelta) => {
      onDelta("pending");
      return untilAbort(request, signal);
    });
    const task = invoke("stream", event, { requestId: "cancel-stream" });
    await invoke("cancel", event, "cancel-stream");
    expect(await task).toEqual({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(100);
    expect(event.sender.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
