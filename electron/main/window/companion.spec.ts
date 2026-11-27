import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rectangle } from "electron";
import { ipcMain, screen } from "electron";
import type { CompanionLayout } from "@shared/types/companion";
import { syncCompanionWindow } from "./companion";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  tray: vi.fn(),
  broadcast: vi.fn(),
  quitting: false,
  frequency: 60,
  position: {} as { x?: unknown; y?: unknown; showAvatar?: boolean },
  cursor: vi.fn(() => ({ x: 1500, y: 800 })),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("./create", () => ({ createWindow: mocks.create }));
vi.mock("@main/services/tray", () => ({ setTrayDesktopPet: mocks.tray }));
vi.mock("@main/utils/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@main/utils/lifecycle", () => ({ isAppQuitting: () => mocks.quitting }));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) =>
      key === "companion"
        ? { enabled: true, showAvatar: true, alwaysOnTop: true, ...mocks.position }
        : false,
    set: mocks.save,
  },
}));
vi.mock("electron", () => {
  const display = { workArea: { x: 0, y: 0, width: 1600, height: 900 } };
  return {
    ipcMain: Object.assign(new EventEmitter(), {
      handle: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn),
      removeHandler: (name: string) => mocks.handlers.delete(name),
    }),
    screen: Object.assign(new EventEmitter(), {
      getCursorScreenPoint: mocks.cursor,
      getPrimaryDisplay: () => display,
      getDisplayNearestPoint: () => ({ ...display, displayFrequency: mocks.frequency }),
    }),
  };
});

/** 创建可观察原生边界和渲染进程事件的浮窗 */
function mockWindow(initial: Rectangle = { x: 1216, y: 392, width: 384, height: 480 }) {
  let bounds: Rectangle = initial;
  let visible = false;
  return Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { send: vi.fn() }),
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => false,
    isFocused: () => false,
    showInactive: vi.fn(() => {
      visible = true;
    }),
    setBounds: vi.fn((next: Rectangle) => {
      bounds = next;
    }),
    getBounds: () => bounds,
    setPosition: vi.fn((x: number, y: number) => {
      bounds = { ...bounds, x, y };
    }),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    loadFile: vi.fn(),
  });
}

describe("听歌陪伴窗口（固定外框平台）", () => {
  let win: ReturnType<typeof mockWindow>;
  let platformSpy: ReturnType<typeof vi.spyOn>;
  const cancel = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    mocks.frequency = 60;
    mocks.quitting = false;
    mocks.position = {};
    cancel.mockClear();
    mocks.cursor.mockReturnValue({ x: 1500, y: 800 });
    mocks.save.mockClear();
    mocks.tray.mockClear();
    mocks.broadcast.mockClear();
    win = mockWindow();
    mocks.create.mockReturnValue(win);
    syncCompanionWindow(cancel);
  });
  afterEach(() => {
    mocks.quitting = true;
    win.emit("closed");
    mocks.quitting = false;
    platformSpy.mockRestore();
    vi.useRealTimers();
  });

  it("外部关闭浮窗时同步 showAvatar 并广播配置，退出应用时保留开启状态", () => {
    win.emit("closed");
    expect(mocks.tray).toHaveBeenLastCalledWith(false);
    expect(mocks.save).toHaveBeenCalledWith(
      "companion",
      expect.objectContaining({ enabled: true, showAvatar: false }),
    );
    expect(mocks.broadcast).toHaveBeenCalledWith(
      "companion:configChange",
      expect.objectContaining({ enabled: true, showAvatar: false }),
    );

    mocks.save.mockClear();
    mocks.broadcast.mockClear();
    mocks.quitting = true;
    win = mockWindow();
    mocks.create.mockReturnValue(win);
    syncCompanionWindow(cancel);
    win.emit("closed");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("在加载页面前按统一外框修正透明窗口并默认透传留白", () => {
    expect(mocks.tray).toHaveBeenCalledExactlyOnceWith(true);
    expect(win.setBounds).toHaveBeenCalledExactlyOnceWith({
      x: 1216,
      y: 392,
      width: 384,
      height: 480,
    });
    expect(win.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
      win.loadFile.mock.invocationCallOrder[0]!,
    );
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ type: "toolbar" }));
    expect(win.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true, "screen-saver");
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledExactlyOnceWith(true, { forward: true });
    win.emit("ready-to-show");
    expect(win.showInactive).toHaveBeenCalledOnce();
    expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(2);
    expect(win.showInactive.mock.invocationCallOrder[0]).toBeLessThan(
      win.setAlwaysOnTop.mock.invocationCallOrder[1]!,
    );
  });

  it("macOS 向上拖动时保持外框在工作区内，避免菜单栏裁切导致角色错位", () => {
    win.emit("closed");
    platformSpy.mockReturnValue("darwin");
    win = mockWindow();
    mocks.create.mockReturnValue(win);
    syncCompanionWindow(cancel);
    const event = { sender: win.webContents };
    ipcMain.emit("companion:beginDrag", event);
    mocks.cursor.mockReturnValue({ x: 1500, y: 80 });
    vi.advanceTimersByTime(32);
    expect(win.getBounds().y).toBeGreaterThanOrEqual(0);
    mocks.handlers.get("companion:endDrag")!(event, false);
  });

  it("外部配置包含无效坐标时仍使用有效的屏幕落点创建统一外框", () => {
    win.emit("closed");
    mocks.position = { x: "invalid", y: null };
    win = mockWindow();
    mocks.create.mockReturnValue(win);
    syncCompanionWindow(cancel);
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 1216, y: 392, width: 384, height: 480 }),
    );
  });

  it("点击展开、收起、快速重开与气泡切换均不调整原生窗口边界，避免闪烁", () => {
    const event = { sender: win.webContents };
    const frameBounds = win.getBounds();
    ipcMain.emit("companion:setExpanded", event, true, 1, "chat");
    ipcMain.emit("companion:setExpanded", event, false, 2, "chat");
    expect(cancel).toHaveBeenCalledOnce();
    ipcMain.emit("companion:setExpanded", event, true, 3, "chat");
    ipcMain.emit("companion:finishCollapse", event, 2);
    ipcMain.emit("companion:setExpanded", event, false, 4, "chat");
    ipcMain.emit("companion:finishCollapse", event, 4);
    ipcMain.emit("companion:setExpanded", event, true, 5, "bubble");
    ipcMain.emit("companion:setExpanded", event, false, 6, "bubble");
    ipcMain.emit("companion:finishCollapse", event, 6);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(win.getBounds()).toEqual(frameBounds);
    expect(win.setBounds).toHaveBeenCalledTimes(1);
  });

  it("显示器切换到 144Hz 后按固定外框平移跟随光标", () => {
    const event = { sender: win.webContents };
    mocks.frequency = 144;
    screen.emit("display-metrics-changed");
    ipcMain.emit("companion:beginDrag", event);
    mocks.cursor.mockReturnValue({ x: 1490, y: 790 });
    vi.advanceTimersByTime(7);
    expect(win.setBounds).toHaveBeenLastCalledWith({ x: 1206, y: 382, width: 384, height: 480 });
  });

  it("气泡展示期间拖至另一侧会翻转，收起后仍保持角色屏幕落点", () => {
    const event = { sender: win.webContents };
    ipcMain.emit("companion:setExpanded", event, true, 1, "bubble");
    ipcMain.emit("companion:beginDrag", event);
    mocks.cursor.mockReturnValue({ x: 8, y: 8 });
    vi.advanceTimersByTime(32);
    mocks.handlers.get("companion:endDrag")!(event, false);
    const layout = mocks.handlers.get("companion:getLayout")!(event) as CompanionLayout;
    expect(layout.bubble.side).toBe("bottom");
    const bounds = win.getBounds();
    expect([bounds.x + layout.frame!.avatarX, bounds.y + layout.frame!.avatarY]).toEqual([0, 0]);
    ipcMain.emit("companion:setExpanded", event, false, 2, "bubble");
    ipcMain.emit("companion:finishCollapse", event, 2);
    expect([
      win.getBounds().x + layout.frame!.avatarX,
      win.getBounds().y + layout.frame!.avatarY,
    ]).toEqual([0, 0]);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("重载时清除未结束的离场并恢复默认留白穿透", () => {
    const event = { sender: win.webContents };
    ipcMain.emit("companion:setIgnoreMouse", event, false);
    ipcMain.emit("companion:setExpanded", event, true, 1, "chat");
    ipcMain.emit("companion:setExpanded", event, false, 2, "chat");
    win.webContents.emit("did-start-loading");
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    ipcMain.emit("companion:setExpanded", event, true, 1, "chat");
    ipcMain.emit("companion:finishCollapse", event, 2);
    expect(cancel).toHaveBeenCalledTimes(2);
    // 旧的离场回调不会把新页面重新打开的聊天标记为收起
    ipcMain.emit("companion:setExpanded", event, false, 3, "chat");
    expect(cancel).toHaveBeenCalledTimes(3);
  });

  it("拖动期间不推送隐藏浮层布局，松手只保存一次并更新气泡的居中方位", () => {
    const event = { sender: win.webContents };
    ipcMain.emit("companion:beginDrag", event);
    vi.advanceTimersByTime(32);
    expect(win.setPosition).not.toHaveBeenCalled();
    mocks.cursor.mockReturnValue({ x: 1330, y: 680 });
    vi.advanceTimersByTime(32);
    expect(win.getBounds()).toMatchObject({ x: 1046, y: 272, width: 384, height: 480 });
    expect(win.setBounds).toHaveBeenCalledTimes(2);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
    mocks.cursor.mockReturnValue({ x: 1320, y: 670 });
    const end = mocks.handlers.get("companion:endDrag")!;
    expect(end(event, false)).toBe(true);
    expect(end(event, false)).toBe(false);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
      "companion",
      expect.objectContaining({ x: 1312, y: 662 }),
    );
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith(
      "companion:layout",
      expect.objectContaining({ bubble: expect.objectContaining({ align: "center" }) }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["blur", "hide", "render-process-gone", "pointercancel"])(
    "%s 释放拖动采样并还原按下位置",
    (reason) => {
      const event = { sender: win.webContents };
      const before = win.getBounds();
      ipcMain.emit("companion:beginDrag", event);
      mocks.cursor.mockReturnValue({ x: 1200, y: 500 });
      vi.advanceTimersByTime(24);
      expect(win.getBounds()).not.toEqual(before);
      if (reason === "pointercancel") mocks.handlers.get("companion:endDrag")!(event, true);
      else if (reason === "render-process-gone") win.webContents.emit(reason);
      else win.emit(reason);
      mocks.cursor.mockReturnValue({ x: 100, y: 100 });
      vi.advanceTimersByTime(80);
      expect(win.getBounds()).toEqual(before);
      expect(vi.getTimerCount()).toBe(0);
      expect(mocks.save).not.toHaveBeenCalled();
    },
  );

  it("分数缩放连续拖动和方向键移动始终指定原始 DIP 尺寸", () => {
    win.setPosition.mockImplementation((x, y) => {
      const current = win.getBounds();
      win.setBounds({ x, y, width: current.width + 1, height: current.height + 1 });
    });
    const event = { sender: win.webContents };
    ipcMain.emit("companion:beginDrag", event);
    for (let step = 1; step <= 13; step++) {
      mocks.cursor.mockReturnValue({ x: 1500 - step * 7, y: 800 - step * 3 });
      vi.advanceTimersByTime(20);
    }
    const dragCalls = win.setBounds.mock.calls.slice(1);
    expect(dragCalls.every(([bounds]) => bounds.width === 384 && bounds.height === 480)).toBe(true);
    mocks.handlers.get("companion:endDrag")!(event, false);
    for (let step = 0; step < 20; step++) ipcMain.emit("companion:moveBy", event, 12, 0);
    expect(win.setPosition).not.toHaveBeenCalled();
    const layout = mocks.handlers.get("companion:getLayout")!(event) as CompanionLayout;
    expect(win.getBounds()).toMatchObject({
      width: layout.frame!.width,
      height: layout.frame!.height,
    });
  });

  it("键盘移动后在左上角保持角色锚点且点击展开不改变窗口尺寸", () => {
    const event = { sender: win.webContents };
    ipcMain.emit("companion:moveBy", event, -1492, -792);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.handlers.get("companion:getLayout")!(event)).toMatchObject({
      avatarX: 0,
      avatarY: 0,
      side: "bottom",
      align: "start",
      frame: { width: 356, height: 480, avatarX: 0, avatarY: 0 },
    });
    expect(win.getBounds()).toMatchObject({ x: 0, y: 0, width: 356, height: 480 });
    const countBeforeExpand = win.setBounds.mock.calls.length;
    ipcMain.emit("companion:setExpanded", event, true, 1);
    expect(win.setBounds).toHaveBeenCalledTimes(countBeforeExpand);
  });
});

describe("听歌陪伴窗口（Linux 缩窗兼容）", () => {
  let win: ReturnType<typeof mockWindow>;
  let platformSpy: ReturnType<typeof vi.spyOn>;
  const cancel = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    mocks.frequency = 60;
    mocks.position = {};
    cancel.mockClear();
    mocks.cursor.mockReturnValue({ x: 1500, y: 800 });
    mocks.save.mockClear();
    win = mockWindow({ x: 1492, y: 792, width: 80, height: 80 });
    mocks.create.mockReturnValue(win);
    syncCompanionWindow(cancel);
  });
  afterEach(() => {
    mocks.quitting = true;
    win.emit("closed");
    mocks.quitting = false;
    platformSpy.mockRestore();
    vi.useRealTimers();
  });

  it("Linux 按内容切换原生窗口大小并在离场后收缩回角色尺寸", () => {
    const event = { sender: win.webContents };
    expect(win.getBounds()).toEqual({ x: 1492, y: 792, width: 80, height: 80 });
    expect(
      (mocks.handlers.get("companion:getLayout")!(event) as CompanionLayout).frame,
    ).toBeUndefined();
    ipcMain.emit("companion:setExpanded", event, true, 1, "chat");
    expect(win.getBounds()).toMatchObject({ width: 356, height: 480 });
    ipcMain.emit("companion:setExpanded", event, false, 2, "chat");
    expect(cancel).toHaveBeenCalledOnce();
    expect(win.getBounds()).toMatchObject({ width: 356, height: 480 });
    ipcMain.emit("companion:finishCollapse", event, 2);
    expect(win.getBounds()).toEqual({ x: 1492, y: 792, width: 80, height: 80 });
    ipcMain.emit("companion:setExpanded", event, true, 3, "bubble");
    expect(win.getBounds()).toMatchObject({ width: 280, height: 184 });
    ipcMain.emit("companion:setExpanded", event, false, 4, "bubble");
    ipcMain.emit("companion:finishCollapse", event, 4);
    expect(win.getBounds()).toEqual({ x: 1492, y: 792, width: 80, height: 80 });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
