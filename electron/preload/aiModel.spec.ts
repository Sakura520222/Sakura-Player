import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeAll: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeAllListeners: mocks.removeAll,
    removeListener: mocks.remove,
  },
}));
import { aiModelApi } from "./aiModel";

let emitter: EventEmitter;
beforeEach(() => {
  vi.clearAllMocks();
  emitter = new EventEmitter();
  mocks.on.mockImplementation((channel, handler) => emitter.on(channel, handler));
  mocks.remove.mockImplementation((channel, handler) => emitter.removeListener(channel, handler));
  mocks.removeAll.mockImplementation((channel) => emitter.removeAllListeners(channel));
});

describe("AI 流式 preload", () => {
  it("消费回调抛错会终止请求，清理监听并返回明确失败", async () => {
    let finish!: (value: unknown) => void;
    mocks.invoke.mockImplementation((channel) => {
      if (channel === "aiModel:cancel") return Promise.resolve(true);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const task = aiModelApi.stream({ requestId: "callback-error", messages: [] }, () => {
      throw new Error("consumer failed");
    });
    let callbackError: unknown;
    try {
      emitter.emit("aiModel:delta:callback-error", {}, "partial");
    } catch (error) {
      callbackError = error;
    }
    finish({ status: "cancelled" });
    const result = await task;
    expect(callbackError).toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledWith("aiModel:cancel", "callback-error");
    expect(result).toMatchObject({ status: "error" });
    expect(emitter.eventNames()).toEqual([]);
  });

  it("先监听再请求，并发流各自接收文本并在结束后解除监听", async () => {
    const resolvers = new Map<string, (value: unknown) => void>();
    mocks.invoke.mockImplementation(
      (_channel, request) =>
        new Promise((resolve) => {
          expect(emitter.listenerCount(`aiModel:delta:${request.requestId}`)).toBe(1);
          resolvers.set(request.requestId, resolve);
        }),
    );
    const first = vi.fn();
    const second = vi.fn();
    const a = aiModelApi.stream({ requestId: "first", messages: [] }, first);
    const b = aiModelApi.stream({ requestId: "second", messages: [] }, second);
    emitter.emit("aiModel:delta:first", {}, "一");
    emitter.emit("aiModel:delta:second", {}, "二");
    expect(first).toHaveBeenCalledExactlyOnceWith("一");
    expect(second).toHaveBeenCalledExactlyOnceWith("二");
    expect(await aiModelApi.stream({ requestId: "first", messages: [] }, vi.fn())).toMatchObject({
      status: "error",
    });
    expect(emitter.listenerCount("aiModel:delta:first")).toBe(1);
    resolvers.get("first")!({ status: "completed", data: { text: "一" } });
    resolvers.get("second")!({ status: "cancelled" });
    await Promise.all([a, b]);
    expect(emitter.eventNames()).toEqual([]);
    expect(mocks.removeAll).toHaveBeenCalledTimes(2);
  });

  it("invoke 失败也清理监听和请求 ID，之后可重用", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("IPC closed"));
    await expect(aiModelApi.stream({ requestId: "retry", messages: [] }, vi.fn())).rejects.toThrow(
      "IPC closed",
    );
    expect(emitter.eventNames()).toEqual([]);
    mocks.invoke.mockResolvedValue({ status: "cancelled" });
    expect(await aiModelApi.stream({ requestId: "retry", messages: [] }, vi.fn())).toEqual({
      status: "cancelled",
    });
    expect(emitter.eventNames()).toEqual([]);
  });
});
