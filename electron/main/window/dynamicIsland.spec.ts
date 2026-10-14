import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerState } from "@shared/types/player";
import type { DynamicIslandVisibilityChange } from "@shared/types/window";

const mocks = vi.hoisted(() => ({
  state: "playing" as PlayerState,
  quitting: false,
  config: {
    hideWhenPaused: false,
    nonOcclusive: false,
    alwaysOnTop: true,
    scale: 1,
    snapCentered: true,
    notchFusion: false,
  },
  saved: { mode: "snapped", x: null, y: null, visible: false },
  createWindow: vi.fn(),
  set: vi.fn(),
  broadcast: vi.fn(),
  tray: vi.fn(),
  cursor: vi.fn(() => ({ x: -1, y: -1 })),
}));

vi.mock("electron", () => ({
  screen: {
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
    }),
    getCursorScreenPoint: mocks.cursor,
  },
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("./create", () => ({ createWindow: mocks.createWindow }));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => (key === "dynamicIsland" ? mocks.config : mocks.saved),
    set: mocks.set,
  },
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@main/utils/config", () => ({ isMac: false }));
vi.mock("@main/utils/lifecycle", () => ({ isAppQuitting: () => mocks.quitting }));
vi.mock("@main/services/tray", () => ({ setTrayDynamicIsland: mocks.tray }));
vi.mock("@main/services/nowPlaying", () => ({ lightSnapshot: () => ({ state: mocks.state }) }));

import {
  applyDynamicIslandNonOcclusive,
  closeDynamicIslandWindow,
  createDynamicIslandWindow,
  getDynamicIslandWindow,
  isDynamicIslandWindowOpen,
  markDynamicIslandRendererReady,
  finishDynamicIslandVisibilityTransition,
  syncDynamicIslandVisibility,
  toggleDynamicIslandWindow,
} from "./dynamicIsland";

const createMockWindow = () => {
  let visible = false;
  let destroyed = false;
  const events = new EventEmitter();
  return Object.assign(events, {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    showInactive: vi.fn(() => (visible = true)),
    hide: vi.fn(() => (visible = false)),
    focus: vi.fn(),
    close: vi.fn(() => {
      destroyed = true;
      events.emit("closed");
    }),
    setAlwaysOnTop: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    getBounds: () => ({ x: 860, y: 0, width: 200, height: 40 }),
    loadFile: vi.fn(),
    webContents: Object.assign(new EventEmitter(), { send: vi.fn(), setZoomFactor: vi.fn() }),
  });
};
let win: ReturnType<typeof createMockWindow>;

const finishHide = (): void => {
  const request = win.webContents.send.mock.calls.findLast(
    ([channel]) => channel === "dynamicIsland:animateVisibility",
  )![1] as DynamicIslandVisibilityChange;
  finishDynamicIslandVisibilityTransition(request.requestId);
};

describe("灵动岛暂停隐藏", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.state = "playing";
    mocks.quitting = false;
    mocks.config.hideWhenPaused = false;
    mocks.config.nonOcclusive = false;
    win = createMockWindow();
    mocks.createWindow.mockReturnValue(win);
  });

  afterEach(() => {
    closeDynamicIslandWindow();
    if (!win.isDestroyed()) win.close();
    vi.useRealTimers();
  });

  it("默认关闭自动隐藏，暂停时继续显示", () => {
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    expect(win.isVisible()).toBe(true);
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("暂停临时隐藏，恢复显示原窗口且不抢焦点或关闭启用开关", () => {
    mocks.config.hideWhenPaused = true;
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    const bounds = win.getBounds();
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    syncDynamicIslandVisibility();
    expect(win.isVisible()).toBe(true);
    finishHide();
    expect(win.isVisible()).toBe(false);
    expect(win.hide).toHaveBeenCalledOnce();
    expect(getDynamicIslandWindow()).toBe(win);
    expect(mocks.set).not.toHaveBeenCalledWith("windowStates.dynamicIsland.visible", false);
    expect(mocks.broadcast).not.toHaveBeenCalledWith("dynamicIsland:visibilityChange", false);
    expect(mocks.tray).not.toHaveBeenCalledWith(false);
    mocks.state = "playing";
    syncDynamicIslandVisibility();
    expect(win.isVisible()).toBe(true);
    expect(win.getBounds()).toEqual(bounds);
    expect(win.focus).not.toHaveBeenCalled();
    expect(mocks.createWindow).toHaveBeenCalledOnce();
  });

  it("窗口就绪前暂停不闪现，就绪后读取最新开关", () => {
    createDynamicIslandWindow();
    mocks.config.hideWhenPaused = true;
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    win.emit("ready-to-show");
    expect(win.showInactive).not.toHaveBeenCalled();
    markDynamicIslandRendererReady();
    createDynamicIslandWindow();
    expect(win.showInactive).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
    mocks.state = "playing";
    syncDynamicIslandVisibility();
    expect(win.isVisible()).toBe(true);
  });

  it("暂停期间修改开关立即显隐，窗口未就绪时不会提前显示", () => {
    mocks.state = "paused";
    mocks.config.hideWhenPaused = true;
    createDynamicIslandWindow();
    mocks.config.hideWhenPaused = false;
    syncDynamicIslandVisibility();
    expect(win.showInactive).not.toHaveBeenCalled();
    markDynamicIslandRendererReady();
    expect(win.isVisible()).toBe(true);
    mocks.config.hideWhenPaused = true;
    syncDynamicIslandVisibility();
    finishHide();
    expect(win.isVisible()).toBe(false);
    mocks.config.hideWhenPaused = false;
    syncDynamicIslandVisibility();
    expect(win.isVisible()).toBe(true);
  });

  it("自动隐藏后仍可手动关闭，恢复播放不会重新开启", () => {
    mocks.config.hideWhenPaused = true;
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    finishHide();
    expect(toggleDynamicIslandWindow()).toBe(false);
    expect(getDynamicIslandWindow()).toBeNull();
    expect(mocks.set).toHaveBeenCalledWith("windowStates.dynamicIsland.visible", false);
    mocks.state = "playing";
    syncDynamicIslandVisibility();
    expect(mocks.createWindow).toHaveBeenCalledOnce();
  });

  it("隐藏时停止鼠标轮询，恢复后重启，关闭后释放定时器", () => {
    mocks.config.hideWhenPaused = true;
    mocks.config.nonOcclusive = true;
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    expect(vi.getTimerCount()).toBe(1);
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    applyDynamicIslandNonOcclusive(true);
    expect(vi.getTimerCount()).toBe(0);
    mocks.state = "playing";
    syncDynamicIslandVisibility();
    expect(vi.getTimerCount()).toBe(1);
    closeDynamicIslandWindow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("快速恢复播放会作废收起动画，过期完成通知不能隐藏窗口", () => {
    mocks.config.hideWhenPaused = true;
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    const request = win.webContents.send.mock.calls.at(-1)![1] as DynamicIslandVisibilityChange;
    mocks.state = "playing";
    syncDynamicIslandVisibility();
    finishDynamicIslandVisibilityTransition(request.requestId);
    expect(win.isVisible()).toBe(true);
    expect(win.hide).not.toHaveBeenCalled();
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    finishDynamicIslandVisibilityTransition(request.requestId);
    expect(win.hide).not.toHaveBeenCalled();
    finishHide();
    expect(win.isVisible()).toBe(false);
  });

  it("渲染端重新订阅时重放当前请求，旧渲染端的完成通知失效", () => {
    mocks.config.hideWhenPaused = true;
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    const request = win.webContents.send.mock.calls.at(-1)![1] as DynamicIslandVisibilityChange;
    markDynamicIslandRendererReady();
    finishDynamicIslandVisibilityTransition(request.requestId);
    expect(win.hide).not.toHaveBeenCalled();
    finishHide();
    expect(win.isVisible()).toBe(false);
  });

  it("手动关闭立即同步开关状态，收起完成后才销毁窗口", () => {
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    expect(toggleDynamicIslandWindow()).toBe(false);
    expect(isDynamicIslandWindowOpen()).toBe(false);
    expect(getDynamicIslandWindow()).toBe(win);
    expect(win.isVisible()).toBe(true);
    expect(win.close).not.toHaveBeenCalled();
    expect(mocks.tray).toHaveBeenLastCalledWith(false);
    expect(mocks.broadcast).toHaveBeenLastCalledWith("dynamicIsland:visibilityChange", false);
    expect(mocks.set).toHaveBeenLastCalledWith("windowStates.dynamicIsland.visible", false);
    mocks.state = "playing";
    syncDynamicIslandVisibility();
    finishHide();
    expect(getDynamicIslandWindow()).toBeNull();
    expect(mocks.broadcast.mock.calls.filter(([, value]) => value === false)).toHaveLength(1);
  });

  it("收起途中重新开启复用窗口并作废关闭请求，再次关闭可正常完成", () => {
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    expect(toggleDynamicIslandWindow()).toBe(false);
    const request = win.webContents.send.mock.calls.at(-1)![1] as DynamicIslandVisibilityChange;
    expect(toggleDynamicIslandWindow()).toBe(true);
    expect(isDynamicIslandWindowOpen()).toBe(true);
    expect(mocks.createWindow).toHaveBeenCalledOnce();
    expect(win.focus).not.toHaveBeenCalled();
    finishDynamicIslandVisibilityTransition(request.requestId);
    expect(win.close).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
    expect(mocks.broadcast).toHaveBeenLastCalledWith("dynamicIsland:visibilityChange", true);
    expect(toggleDynamicIslandWindow()).toBe(false);
    finishDynamicIslandVisibilityTransition(request.requestId);
    expect(win.close).not.toHaveBeenCalled();
    finishHide();
    expect(win.isDestroyed()).toBe(true);
  });

  it("关闭途中改变暂停策略不能重新开启已关掉的开关", () => {
    mocks.config.hideWhenPaused = true;
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    closeDynamicIslandWindow();
    mocks.config.hideWhenPaused = false;
    mocks.state = "playing";
    syncDynamicIslandVisibility();
    expect(isDynamicIslandWindowOpen()).toBe(false);
    finishHide();
    expect(getDynamicIslandWindow()).toBeNull();
  });

  it("暂停期间取消手动关闭会继续自动隐藏，恢复后显示同一个窗口", () => {
    mocks.config.hideWhenPaused = true;
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    mocks.state = "paused";
    syncDynamicIslandVisibility();
    closeDynamicIslandWindow();
    expect(toggleDynamicIslandWindow()).toBe(true);
    finishHide();
    expect(win.close).not.toHaveBeenCalled();
    expect(win.isVisible()).toBe(false);
    expect(isDynamicIslandWindowOpen()).toBe(true);
    mocks.state = "playing";
    syncDynamicIslandVisibility();
    expect(win.isVisible()).toBe(true);
    expect(mocks.createWindow).toHaveBeenCalledOnce();
  });

  it("退出应用直接关闭窗口，保留重启恢复的启用选择", () => {
    createDynamicIslandWindow();
    markDynamicIslandRendererReady();
    mocks.quitting = true;
    closeDynamicIslandWindow();
    expect(win.isDestroyed()).toBe(true);
    expect(mocks.set).not.toHaveBeenCalledWith("windowStates.dynamicIsland.visible", false);
  });
});
