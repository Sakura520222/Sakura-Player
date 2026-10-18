import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  sender: {},
  showReady: vi.fn(),
  showError: vi.fn(),
  quit: vi.fn(),
  logError: vi.fn(),
  islandSender: {},
  islandReady: vi.fn(),
  finishVisibility: vi.fn(),
  islandOpen: true,
}));

vi.mock("electron", () => ({
  app: { getName: () => "Sakura Player", quit: mocks.quit },
  dialog: { showErrorBox: mocks.showError },
  ipcMain: { handle: mocks.handle, on: mocks.on },
}));
vi.mock("@main/store", () => ({ store: { get: vi.fn() } }));
vi.mock("@main/utils/config", () => ({ isWin: false }));
vi.mock("@main/utils/logger", () => ({ coreLog: { error: mocks.logError } }));
vi.mock("@main/utils/powerBlocker", () => ({ setPlayerExpanded: vi.fn() }));
vi.mock("@main/window", () => ({
  getMainWindow: () => ({ webContents: mocks.sender }),
  showReadyMainWindow: mocks.showReady,
  getDynamicIslandWindow: () => ({ webContents: mocks.islandSender }),
  isDynamicIslandWindowOpen: () => mocks.islandOpen,
  markDynamicIslandRendererReady: mocks.islandReady,
  finishDynamicIslandVisibilityTransition: mocks.finishVisibility,
}));

import { registerWindowIpc } from "./window";

describe("启动窗口 IPC 职责", () => {
  const complete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.islandOpen = true;
    registerWindowIpc(complete);
  });

  it("就绪请求等待显示窗口，不启动后台任务或弹出错误", async () => {
    const ready = mocks.handle.mock.calls.find(([channel]) => channel === "window:ready")![1];
    const shown = Promise.resolve();
    mocks.showReady.mockReturnValue(shown);
    expect(ready({ sender: mocks.sender })).toBe(shown);
    await shown;
    expect(mocks.showReady).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("启动完成只通知应用核心调度后续任务", () => {
    const handler = mocks.handle.mock.calls.find(
      ([channel]) => channel === "window:startupComplete",
    )![1];
    handler({ sender: mocks.sender });
    expect(complete).toHaveBeenCalledOnce();
    expect(mocks.showReady).not.toHaveBeenCalled();
    expect(mocks.showError).not.toHaveBeenCalled();
  });

  it("其他窗口不能控制主窗口启动或触发致命错误退出", () => {
    for (const channel of ["window:ready", "window:startupComplete"]) {
      const handler = mocks.handle.mock.calls.find(([name]) => name === channel)![1];
      expect(() => handler({ sender: {} })).toThrow("窗口来源无效");
    }
    const failed = mocks.on.mock.calls.find(([channel]) => channel === "window:startupFailed")![1];
    failed({ sender: {} }, "加载失败");
    expect(complete).not.toHaveBeenCalled();
    expect(mocks.showReady).not.toHaveBeenCalled();
    expect(mocks.showError).not.toHaveBeenCalled();
    expect(mocks.quit).not.toHaveBeenCalled();
  });

  it("致命启动失败独立记录日志、提示并退出，不走就绪流程", () => {
    const failed = mocks.on.mock.calls.find(([channel]) => channel === "window:startupFailed")![1];
    failed({ sender: mocks.sender }, "加载失败");
    expect(mocks.logError).toHaveBeenCalledWith("渲染进程启动失败", "加载失败");
    expect(mocks.showError).toHaveBeenCalledWith("Sakura Player", "加载失败");
    expect(mocks.quit).toHaveBeenCalledOnce();
    expect(mocks.showReady).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("显隐动画就绪和完成通知只接受灵动岛窗口本身", () => {
    const ready = mocks.handle.mock.calls.find(([name]) => name === "dynamicIsland:ready")![1];
    const finished = mocks.on.mock.calls.find(
      ([name]) => name === "dynamicIsland:finishVisibilityTransition",
    )![1];
    ready({ sender: mocks.sender });
    finished({ sender: mocks.sender }, 7);
    expect(mocks.islandReady).not.toHaveBeenCalled();
    expect(mocks.finishVisibility).not.toHaveBeenCalled();
    ready({ sender: mocks.islandSender });
    finished({ sender: mocks.islandSender }, 7);
    expect(mocks.islandReady).toHaveBeenCalledOnce();
    expect(mocks.finishVisibility).toHaveBeenCalledWith(7);
  });

  it("启用状态查询不把仍在收起的窗口视为开启", () => {
    const query = mocks.handle.mock.calls.find(
      ([name]) => name === "window:isDynamicIslandOpen",
    )![1];
    mocks.islandOpen = false;
    expect(query()).toBe(false);
    mocks.islandOpen = true;
    expect(query()).toBe(true);
  });
});
