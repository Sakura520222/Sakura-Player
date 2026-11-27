import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { screen } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAlwaysOnTopKeeper,
  OVERLAY_TOP_LEVEL,
  overlayWindowType,
  type AlwaysOnTopKeeper,
} from "./alwaysOnTop";

vi.mock("electron", () => ({
  screen: new EventEmitter(),
}));

/** 创建支持置顶、最小化、焦点与事件回放的测试窗口 */
function createFakeWindow(initialVisible = false) {
  let visible = initialVisible;
  let minimized = false;
  let focused = false;
  let destroyed = false;
  let rejectUnminimize = false;
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isMinimized: () => minimized,
    isFocused: () => focused,
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    restore: vi.fn(),
    showInactive: vi.fn(() => {
      if (rejectUnminimize) return;
      visible = true;
      minimized = false;
      emitter.emit("show");
    }),
    setVisible: (v: boolean) => {
      visible = v;
    },
    setMinimized: (m: boolean) => {
      minimized = m;
    },
    setFocused: (f: boolean) => {
      focused = f;
    },
    setRejectUnminimize: (reject: boolean) => {
      rejectUnminimize = reject;
    },
    destroyNow: () => {
      destroyed = true;
      emitter.emit("closed");
    },
  });
}

describe("悬浮窗全局置顶维护", () => {
  let platformSpy: ReturnType<typeof vi.spyOn>;
  const createdKeepers: AlwaysOnTopKeeper[] = [];

  /** 创建并登记托管器，确保断言失败也能在 afterEach 回收共享定时器 */
  function createTrackedKeeper(
    win: ReturnType<typeof createFakeWindow>,
    options: { enabled: boolean; shouldBeVisible?: () => boolean },
  ): AlwaysOnTopKeeper {
    const keeper = createAlwaysOnTopKeeper(win as unknown as BrowserWindow, options);
    createdKeepers.push(keeper);
    return keeper;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  });

  afterEach(() => {
    while (createdKeepers.length > 0) createdKeepers.pop()!.dispose();
    platformSpy.mockRestore();
    vi.useRealTimers();
  });

  it("Windows 启用 toolbar 窗口类型并周期复核未聚焦置顶窗，聚焦输入或隐藏时暂停", () => {
    expect(overlayWindowType()).toEqual({ type: "toolbar" });
    const win = createFakeWindow(false);
    let shown = false;
    const keeper = createTrackedKeeper(win, { enabled: true, shouldBeVisible: () => shown });

    expect(win.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true, OVERLAY_TOP_LEVEL);
    expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    // 窗口未展示前不启动复核定时器
    expect(vi.getTimerCount()).toBe(0);

    shown = true;
    win.showInactive();
    keeper.elevate();
    expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(1);

    // 聚焦时不重复强抬层级，避免干扰输入法候选窗
    win.setFocused(true);
    vi.advanceTimersByTime(1500);
    expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(3);

    // 失焦后周期复核自动恢复被压下的 Z-order
    win.setFocused(false);
    vi.advanceTimersByTime(1500);
    expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(4);

    // 隐藏后停止定时器
    win.setVisible(false);
    win.emit("hide");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Windows 下意外最小化仅通过 showInactive 无焦点恢复，限制连续失败重试且不提前展示未就绪窗口", async () => {
    // 尚未完成首次展示的隐藏窗口收到 minimize 时不应被提前显示
    const hiddenWin = createFakeWindow(false);
    createTrackedKeeper(hiddenWin, { enabled: true, shouldBeVisible: () => false });
    hiddenWin.setMinimized(true);
    hiddenWin.emit("minimize");
    await Promise.resolve();
    expect(hiddenWin.showInactive).not.toHaveBeenCalled();

    const win = createFakeWindow(true);
    createTrackedKeeper(win, { enabled: true });
    win.setAlwaysOnTop.mockClear();

    win.setMinimized(true);
    win.emit("minimize");
    await Promise.resolve();
    expect(win.restore).not.toHaveBeenCalled();
    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(true, OVERLAY_TOP_LEVEL);

    // 周期复核在冷却后同样能兜底检测外部最小化
    win.setMinimized(true);
    vi.advanceTimersByTime(1500);
    expect(win.showInactive).toHaveBeenCalledTimes(2);

    // 若系统持续拒绝还原，必须在限定次数内停止争夺，不陷入死循环
    win.showInactive.mockClear();
    win.setRejectUnminimize(true);
    win.setMinimized(true);
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(300);
      win.emit("minimize");
      await Promise.resolve();
    }
    expect(win.showInactive.mock.calls.length).toBeLessThanOrEqual(3);

    // 分辨率切换在正常可见态下照常触发置顶复核
    win.setRejectUnminimize(false);
    win.setMinimized(false);
    win.setVisible(true);
    win.setAlwaysOnTop.mockClear();
    screen.emit("display-metrics-changed");
    expect(win.setAlwaysOnTop).toHaveBeenCalledOnce();

    win.destroyNow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Windows 下焦点在同伴悬浮窗间切换时失焦复核不反抢层，已销毁窗口直接返回空控制器", async () => {
    const winA = createFakeWindow(true);
    const winB = createFakeWindow(true);
    createTrackedKeeper(winA, { enabled: true });
    createTrackedKeeper(winB, { enabled: true });
    winA.setAlwaysOnTop.mockClear();

    // 焦点移至另一个受管理的悬浮窗时，winA 失焦不应把自己重新抬到 winB 之上
    winB.setFocused(true);
    winA.emit("blur");
    await Promise.resolve();
    expect(winA.setAlwaysOnTop).not.toHaveBeenCalled();

    // 焦点离开所有悬浮窗（例如切到其他应用）时正常复核
    winB.setFocused(false);
    winA.emit("blur");
    await Promise.resolve();
    expect(winA.setAlwaysOnTop).toHaveBeenCalledOnce();

    // 已销毁窗口不会残留监听或定时器
    const dead = createFakeWindow(false);
    dead.destroyNow();
    const deadKeeper = createTrackedKeeper(dead, { enabled: true });
    deadKeeper.elevate();
    expect(dead.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("macOS 仅在置顶状态实际变化时同步跨全屏工作区，避免重复触发 Dock 闪烁", () => {
    platformSpy.mockReturnValue("darwin");
    expect(overlayWindowType()).toEqual({});

    // 初始关闭置顶时不主动调用 setVisibleOnAllWorkspaces
    const disabledWin = createFakeWindow(true);
    const disabledKeeper = createTrackedKeeper(disabledWin, { enabled: false });
    expect(disabledWin.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
    disabledKeeper.dispose();

    const win = createFakeWindow(true);
    const keeper = createTrackedKeeper(win, { enabled: true });
    expect(win.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true, OVERLAY_TOP_LEVEL);
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledExactlyOnceWith(true, {
      visibleOnFullScreen: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    // 重复同步相同开关或重复抬升不再次触发工作区切换
    keeper.sync(true);
    keeper.elevate();
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledOnce();

    // 关闭置顶时同步关闭 visibleOnFullScreen
    keeper.sync(false);
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false, OVERLAY_TOP_LEVEL);
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(false, {
      visibleOnFullScreen: false,
    });
    keeper.dispose();
    expect(win.listenerCount("closed")).toBe(0);
  });
});
