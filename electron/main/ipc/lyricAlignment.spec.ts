import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { alignmentRequestSchema } from "@main/services/lyricAlignment";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  once: vi.fn(),
  run: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  status: vi.fn(),
  cancelInstall: vi.fn(),
  listener: vi.fn(),
  windows: vi.fn(),
  fromWebContents: vi.fn(),
  busy: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { once: mocks.once },
  ipcMain: { handle: mocks.handle },
  BrowserWindow: { getAllWindows: mocks.windows, fromWebContents: mocks.fromWebContents },
}));
vi.mock("@main/services/lyricAlignment/environment", () => ({
  acquireAlignmentEnvironment: vi.fn(),
  alignmentScript: "align.py",
  installAlignmentEnvironment: mocks.install,
  uninstallAlignmentEnvironment: mocks.uninstall,
  getAlignmentEnvironmentStatus: mocks.status,
  cancelAlignmentEnvironmentInstall: mocks.cancelInstall,
  setAlignmentEnvironmentListener: mocks.listener,
  isAlignmentEnvironmentBusy: mocks.busy,
}));
vi.mock("@main/services/lyricAlignment", async (original) => ({
  ...(await original<typeof import("@main/services/lyricAlignment")>()),
  runLocalAlignment: mocks.run,
}));
import { registerLyricAlignmentIpc } from "./lyricAlignment";

const request = {
  requestId: "fixture",
  translation: false,
  romanization: true,
  lines: [{ id: 0, words: ["君", "と"], translation: "", romanization: "kimi to" }],
};

/** 构造有生命周期的 IPC 主框架发送方 */
const sender = (id = 1) => {
  const emitter = Object.assign(new EventEmitter(), {
    id,
    mainFrame: {},
    isDestroyed: () => false,
  });
  return { sender: emitter, senderFrame: emitter.mainFrame } as unknown as IpcMainInvokeEvent;
};

/** 读取注册后的 IPC 回调 */
const handler = (name: string) => mocks.handle.mock.calls.find(([channel]) => channel === name)![1];

beforeEach(() => {
  mocks.handle.mockClear();
  mocks.run.mockReset().mockResolvedValue({ lines: [] });
  mocks.windows.mockReset().mockReturnValue([]);
  mocks.busy.mockReset().mockReturnValue(false);
  mocks.fromWebContents.mockReset();
  for (const callback of [
    mocks.install,
    mocks.uninstall,
    mocks.status,
    mocks.cancelInstall,
    mocks.once,
  ])
    callback.mockReset();
  registerLyricAlignmentIpc();
});

describe("本地算法 IPC 生命周期与输入边界", () => {
  it("维护期间关闭到后台且不取消安装，空闲或子框架不改变窗口", () => {
    const owner = sender();
    const hide = vi.fn();
    mocks.fromWebContents.mockReturnValue({ isDestroyed: () => false, hide });
    const background = handler("lyricAlignment:continueInBackground");
    expect(background(owner)).toBe(false);
    mocks.busy.mockReturnValue(true);
    expect(background({ ...owner, senderFrame: {} })).toBe(false);
    expect(background(owner)).toBe(true);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(mocks.cancelInstall).not.toHaveBeenCalled();
  });
  it("发起窗口销毁后安装仍能完成，只有显式退出才中止环境安装", async () => {
    let finish!: (value: object) => void;
    mocks.install.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const owner = sender();
    const pending = handler("lyricAlignment:installEnvironment")(owner);
    owner.sender.emit("destroyed");
    expect(mocks.cancelInstall).not.toHaveBeenCalled();
    finish({ phase: "ready" });
    expect(await pending).toEqual({ phase: "ready" });
    mocks.once.mock.calls.find(([event]) => event === "before-quit")![1]();
    expect(mocks.cancelInstall).toHaveBeenCalledTimes(1);
  });
  it("隐藏窗口只接收阶段变化，推送失败不会中断安装", () => {
    const send = vi.fn();
    const window = {
      isDestroyed: () => false,
      isVisible: () => false,
      webContents: { isDestroyed: () => false, send },
    };
    mocks.windows.mockReturnValue([window]);
    const publish = mocks.listener.mock.calls.at(-1)![0];
    publish({ phase: "downloading-model", downloadedBytes: 1 });
    publish({ phase: "downloading-model", downloadedBytes: 2 });
    expect(send).toHaveBeenCalledTimes(1);
    send.mockImplementationOnce(() => {
      throw new Error("frame gone");
    });
    expect(() => publish({ phase: "ready" })).not.toThrow();
  });
  it("环境查询不触发安装，安装和卸载拒绝子框架", () => {
    const owner = sender();
    handler("lyricAlignment:environmentStatus")(owner);
    expect(mocks.status).toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    for (const action of [
      "installEnvironment",
      "uninstallEnvironment",
      "cancelEnvironmentInstall",
    ]) {
      expect(() => handler(`lyricAlignment:${action}`)({ ...owner, senderFrame: {} })).toThrow(
        "来源",
      );
    }
    handler("lyricAlignment:installEnvironment")(owner);
    expect(mocks.install).toHaveBeenCalledTimes(1);
  });
  it("拒绝重复行、过长输入和子框架请求", async () => {
    expect(
      alignmentRequestSchema.safeParse({ ...request, lines: [...request.lines, ...request.lines] })
        .success,
    ).toBe(false);
    expect(
      alignmentRequestSchema.safeParse({
        ...request,
        lines: Array.from({ length: 1000 }, (_, id) => ({
          ...request.lines[0],
          id,
          romanization: "a".repeat(100),
        })),
      }).success,
    ).toBe(false);
    const event = sender();
    const result = await handler("lyricAlignment:align")({ ...event, senderFrame: {} }, request);
    expect(result.status).toBe("error");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("同一时刻只启动一个任务，只有所有者能取消", async () => {
    let finish!: (value: object) => void;
    mocks.run.mockImplementationOnce(
      (_request, signal: AbortSignal) =>
        new Promise((resolve) => {
          finish = resolve;
          signal.addEventListener("abort", () => resolve({ lines: [] }));
        }),
    );
    const owner = sender();
    const running = handler("lyricAlignment:align")(owner, request);
    expect((await handler("lyricAlignment:align")(sender(2), request)).status).toBe("error");
    expect(handler("lyricAlignment:cancel")(sender(2), "fixture")).toBe(false);
    expect(handler("lyricAlignment:cancel")(owner, "fixture")).toBe(true);
    expect((await running).status).toBe("cancelled");
    expect(owner.sender.listenerCount("destroyed")).toBe(0);
    finish({ lines: [] });
    expect((await handler("lyricAlignment:align")(owner, request)).status).toBe("completed");
  });
  it.each(["destroyed", "render-process-gone"])("%s 会中断工作并清理监听器", async (event) => {
    mocks.run.mockImplementationOnce(
      (_request, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")));
        }),
    );
    const owner = sender();
    const running = handler("lyricAlignment:align")(owner, request);
    owner.sender.emit(event);
    expect((await running).status).toBe("cancelled");
    expect(owner.sender.listenerCount("did-start-navigation")).toBe(0);
  });
});
