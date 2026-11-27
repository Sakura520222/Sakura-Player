import {
  ipcMain,
  screen,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Point,
} from "electron";
import { join } from "node:path";
import { is } from "@electron-toolkit/utils";
import { store } from "@main/store";
import { setTrayDesktopPet } from "@main/services/tray";
import { broadcast } from "@main/utils/broadcast";
import { isAppQuitting } from "@main/utils/lifecycle";
import {
  COMPANION_AVATAR_SIZE,
  type CompanionFrame,
  type CompanionLayout,
  type CompanionPlacement,
  type CompanionSurface,
} from "@shared/types/companion";
import { createAlwaysOnTopKeeper, overlayWindowType, type AlwaysOnTopKeeper } from "./alwaysOnTop";
import { createWindow } from "./create";
import { companionBounds } from "./companionBounds";

let companionWindow: BrowserWindow | null = null;
let companionTopper: AlwaysOnTopKeeper | undefined;
let syncMouse: (() => void) | undefined;

/**
 * 检查角色相对浮层的位置和视口尺寸是否变化，避免拖动时逐帧推送 IPC
 * @param previous - 上次发送的布局
 * @param next - 新布局
 * @returns 渲染端是否需要更新
 */
function placementChanged(previous: CompanionPlacement, next: CompanionPlacement): boolean {
  return (
    previous.avatarX !== next.avatarX ||
    previous.avatarY !== next.avatarY ||
    previous.width !== next.width ||
    previous.height !== next.height ||
    previous.side !== next.side ||
    previous.align !== next.align
  );
}

/**
 * 检查固定宿主外框是否变化
 * @param previous - 上次发送的外框
 * @param next - 新外框
 * @returns 外框尺寸或角色偏移是否变化
 */
function frameChanged(previous?: CompanionFrame, next?: CompanionFrame): boolean {
  return (
    previous?.width !== next?.width ||
    previous?.height !== next?.height ||
    previous?.avatarX !== next?.avatarX ||
    previous?.avatarY !== next?.avatarY
  );
}

/** 获取仍在运行的听歌陪伴窗口 */
export function getCompanionWindow(): BrowserWindow | null {
  return companionWindow && !companionWindow.isDestroyed() ? companionWindow : null;
}

/**
 * 根据陪伴设置同步桌面角色窗口，隐藏时释放渲染进程
 * @param cancel - 收起聊天、关闭或重新加载窗口时取消当前请求
 */
export function syncCompanionWindow(cancel: () => void): void {
  const settings = store.get("companion");
  const current = getCompanionWindow();
  if (!settings.enabled || !settings.showAvatar) {
    current?.destroy();
    setTrayDesktopPet(false);
    return;
  }
  if (current) {
    companionTopper?.sync(settings.alwaysOnTop);
    syncMouse?.();
    return;
  }

  const primary = screen.getPrimaryDisplay().workArea;
  let anchor: Point = {
    x: Number.isFinite(settings.x)
      ? Math.round(Number(settings.x))
      : primary.x + primary.width - COMPANION_AVATAR_SIZE - 28,
    y: Number.isFinite(settings.y)
      ? Math.round(Number(settings.y))
      : primary.y + primary.height - COMPANION_AVATAR_SIZE - 28,
  };
  // Windows 和 macOS 支持透明留白转发鼠标移动，保持统一外框避免开关面板时改窗闪烁
  const keepExpandedFrame = process.platform !== "linux";
  let surface: CompanionSurface | "avatar" = "avatar";
  let closingRevision: number | undefined;
  let transparentPixel = keepExpandedFrame;

  /** 选择离角色中心最近的屏幕，在拔除外接显示器后也能找到窗口 */
  const getDisplay = () =>
    screen.getDisplayNearestPoint({
      x: anchor.x + COMPANION_AVATAR_SIZE / 2,
      y: anchor.y + COMPANION_AVATAR_SIZE / 2,
    });
  let display = getDisplay();
  let geometry = companionBounds(anchor, display.workArea);
  anchor = { x: geometry.closed.x, y: geometry.closed.y };
  /** 按当前平台决定是否向渲染进程暴露固定外框 */
  const resolveLayout = (): CompanionLayout =>
    keepExpandedFrame ? geometry.layout : { ...geometry.layout, frame: undefined };
  let publishedLayout = resolveLayout();
  let drag:
    | {
        origin: Point;
        pointer: Point;
        moved: boolean;
        frameOffset?: Point;
        frameSize?: { width: number; height: number };
      }
    | undefined;
  let dragTimer: ReturnType<typeof setTimeout> | undefined;
  const initialBounds = keepExpandedFrame ? geometry.frame : geometry.closed;
  const win = createWindow({
    ...initialBounds,
    ...overlayWindowType(),
    minWidth: 1,
    minHeight: 1,
    title: "Sakura Player · Listening Companion",
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: true,
    roundedCorners: false,
    webPreferences: { disableDialogs: true, zoomFactor: 1 },
  });
  // Windows 创建透明窗口时可能放大初始内容区，页面加载前按目标 DIP 纠正一次
  win.setBounds(initialBounds);
  let shown = false;
  const topper = createAlwaysOnTopKeeper(win, {
    enabled: settings.alwaysOnTop,
    shouldBeVisible: () => shown,
  });
  companionTopper = topper;
  let previousBounds = initialBounds;
  companionWindow = win;
  setTrayDesktopPet(true);
  let ignored: boolean | undefined;

  /** 用户设定整窗穿透优先于渲染端的透明边缘命中 */
  const updateMouse = () => {
    const next = store.get("companion").clickThrough || (!drag && transparentPixel);
    if (next === ignored) return;
    ignored = next;
    win.setIgnoreMouseEvents(next, { forward: true });
  };
  syncMouse = updateMouse;
  updateMouse();

  /** 屏幕或面板尺寸变化时按共同锚点重新布局 */
  const updateBounds = () => {
    const previousDisplayId = display.id;
    display = getDisplay();
    geometry = companionBounds(anchor, display.workArea);
    anchor = { x: geometry.closed.x, y: geometry.closed.y };
    if (drag?.frameOffset && display.id !== previousDisplayId) {
      drag.frameOffset = { x: geometry.frame.x - anchor.x, y: geometry.frame.y - anchor.y };
      drag.frameSize = { width: geometry.frame.width, height: geometry.frame.height };
    }
    const layout = resolveLayout();
    const keepStaticDragFrame =
      keepExpandedFrame &&
      process.platform !== "darwin" &&
      Boolean(drag && surface === "avatar" && drag.frameOffset && drag.frameSize);
    if (
      (!keepStaticDragFrame || display.id !== previousDisplayId) &&
      (!drag || surface !== "avatar" || !keepStaticDragFrame) &&
      (placementChanged(publishedLayout, layout) ||
        placementChanged(publishedLayout.bubble, layout.bubble) ||
        frameChanged(publishedLayout.frame, layout.frame))
    ) {
      publishedLayout = layout;
      win.webContents.send("companion:layout", layout);
    }
    const next = keepExpandedFrame
      ? keepStaticDragFrame && drag?.frameOffset && drag.frameSize
        ? {
            x: anchor.x + drag.frameOffset.x,
            y: anchor.y + drag.frameOffset.y,
            width: drag.frameSize.width,
            height: drag.frameSize.height,
          }
        : geometry.frame
      : surface === "chat"
        ? geometry.open
        : surface === "bubble"
          ? geometry.bubble
          : geometry.closed;
    if (
      next.width !== previousBounds.width ||
      next.height !== previousBounds.height ||
      next.x !== previousBounds.x ||
      next.y !== previousBounds.y
    ) {
      // 分数缩放下 setPosition 会回读取整后的窗口尺寸，拖动时必须同时指定目标宽高
      win.setBounds(next);
    }
    previousBounds = next;
  };

  /**
   * 展开时先扩大原生窗口，收起时立即取消对话并等待面板离场
   * @param event - 发起请求的渲染进程
   * @param next - 指定内容的展开状态
   * @param revision - 本次切换的序号
   * @param requested - 聊天面板或回复气泡
   */
  const setExpanded = (
    event: IpcMainEvent,
    next: boolean,
    revision: number,
    requested: CompanionSurface = "chat",
  ) => {
    if (
      event.sender !== win.webContents ||
      typeof next !== "boolean" ||
      (requested !== "chat" && requested !== "bubble") ||
      !Number.isSafeInteger(revision)
    )
      return;
    if (!next) {
      if (surface !== requested) return;
      if (surface === "chat" && closingRevision === undefined) cancel();
      closingRevision = revision;
      return;
    }
    if (requested === "bubble" && surface === "chat" && closingRevision === undefined) return;
    closingRevision = undefined;
    if (surface === requested) return;
    surface = requested;
    if (!keepExpandedFrame) {
      transparentPixel = false;
      updateMouse();
      updateBounds();
    }
  };

  /**
   * 当前面板的离场动画结束后收缩窗口，忽略已重新展开的旧回调
   * @param event - 发起请求的渲染进程
   * @param revision - 开始离场时捕获的序号
   */
  const finishCollapse = (event: IpcMainEvent, revision: number) => {
    if (
      event.sender !== win.webContents ||
      closingRevision === undefined ||
      revision !== closingRevision
    )
      return;
    closingRevision = undefined;
    surface = "avatar";
    if (!keepExpandedFrame) {
      transparentPixel = false;
      updateMouse();
      updateBounds();
    }
  };

  /** 写入约束到工作区后的角色屏幕坐标 */
  const savePosition = () => store.set("companion", { ...store.get("companion"), ...anchor });

  /** 仅在手势期间采样原生 DIP 坐标，避免移动窗口产生新的局部坐标反馈 */
  const followCursor = () => {
    if (!drag) return;
    const point = screen.getCursorScreenPoint();
    const dx = point.x - drag.pointer.x;
    const dy = point.y - drag.pointer.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    const x = drag.origin.x + dx;
    const y = drag.origin.y + dy;
    if (anchor.x === x && anchor.y === y) return;
    anchor = { x, y };
    updateBounds();
  };

  /** 按角色当前显示器的刷新率采样，跨屏后立即使用新频率 */
  const tickDrag = () => {
    if (!drag) return;
    followCursor();
    const hz = display.displayFrequency > 0 ? display.displayFrequency : 60;
    dragTimer = setTimeout(tickDrag, Math.max(1, Math.round(1000 / hz)));
  };

  /**
   * 结束系统光标采样，取消时恢复按下位置，松手后只保存一次
   * @param cancelled - 是否放弃当前拖动
   * @returns 角色是否实际发生过拖动
   */
  const stopDrag = (cancelled: boolean): boolean => {
    clearTimeout(dragTimer);
    dragTimer = undefined;
    if (!drag) return false;
    if (!cancelled) followCursor();
    const { origin, moved } = drag;
    drag = undefined;
    if (cancelled && moved) anchor = origin;
    updateBounds();
    if (!cancelled && moved) savePosition();
    updateMouse();
    return moved;
  };

  /**
   * 从当前系统指针与角色坐标开始跟随
   * @param event - 发起捕获的陪伴窗口
   */
  const beginDrag = (event: IpcMainEvent) => {
    if (event.sender !== win.webContents || drag) return;
    const lockFrameOffset = keepExpandedFrame && process.platform !== "darwin";
    drag = {
      origin: anchor,
      pointer: screen.getCursorScreenPoint(),
      moved: false,
      frameOffset: lockFrameOffset
        ? { x: previousBounds.x - anchor.x, y: previousBounds.y - anchor.y }
        : undefined,
      frameSize: lockFrameOffset
        ? { width: previousBounds.width, height: previousBounds.height }
        : undefined,
    };
    updateMouse();
    tickDrag();
  };

  /**
   * 接收角色按钮释放或取消的手势
   * @param event - 已捕获指针的陪伴窗口
   * @param cancelled - 是否因取消或页面失去交互而终止
   * @returns 是否应抑制紧随其后的角色点击
   */
  const endDrag = (event: IpcMainInvokeEvent, cancelled: boolean): boolean =>
    event.sender === win.webContents && typeof cancelled === "boolean" && stopDrag(cancelled);

  /**
   * 按键盘方向调整角色锚点并保存可见位置
   * @param event - 发起请求的窗口
   * @param dx - 水平位移
   * @param dy - 垂直位移
   */
  const moveBy = (event: IpcMainEvent, dx: number, dy: number) => {
    if (
      event.sender !== win.webContents ||
      drag ||
      !Number.isSafeInteger(dx) ||
      !Number.isSafeInteger(dy)
    )
      return;
    anchor = { x: anchor.x + dx, y: anchor.y + dy };
    updateBounds();
    savePosition();
  };

  /**
   * 获取当前锚点对应的展开布局，以便首帧就能放置角色
   * @param event - 发起请求的窗口
   * @returns 角色偏移和面板方位
   */
  const getLayout = (event: IpcMainInvokeEvent): CompanionLayout => {
    if (event.sender !== win.webContents) throw new Error("无权读取陪伴窗口布局");
    return resolveLayout();
  };

  /**
   * 让窗口的透明留白透传点击
   * @param event - 发起请求的渲染进程
   * @param empty - 光标是否位于透明留白
   */
  const setIgnoreMouse = (event: IpcMainEvent, empty: boolean) => {
    if (event.sender !== win.webContents || typeof empty !== "boolean") return;
    // Linux 不支持转发鼠标移动，整窗穿透仍由设置控制
    transparentPixel = process.platform !== "linux" && empty;
    updateMouse();
  };

  ipcMain.on("companion:setExpanded", setExpanded);
  ipcMain.on("companion:finishCollapse", finishCollapse);
  ipcMain.on("companion:beginDrag", beginDrag);
  ipcMain.handle("companion:endDrag", endDrag);
  ipcMain.handle("companion:getLayout", getLayout);
  ipcMain.on("companion:moveBy", moveBy);
  ipcMain.on("companion:setIgnoreMouse", setIgnoreMouse);
  screen.on("display-removed", updateBounds);
  screen.on("display-metrics-changed", updateBounds);
  win.once("ready-to-show", () => {
    shown = true;
    win.showInactive();
    topper.elevate();
  });
  /** 页面失去捕获或宿主窗口不再交互时停止采样 */
  const cancelDrag = () => stopDrag(true);
  win.on("blur", cancelDrag);
  win.on("hide", cancelDrag);
  /** 失去旧页面后复原浮窗，避免未结束的手势或离场影响下一页面 */
  const resetPanel = () => {
    cancelDrag();
    if (surface !== "avatar") cancel();
    closingRevision = undefined;
    surface = "avatar";
    transparentPixel = keepExpandedFrame;
    updateMouse();
    updateBounds();
  };
  win.webContents.on("did-start-loading", resetPanel);
  win.webContents.on("render-process-gone", resetPanel);
  win.on("closed", () => {
    ipcMain.off("companion:setExpanded", setExpanded);
    ipcMain.off("companion:finishCollapse", finishCollapse);
    clearTimeout(dragTimer);
    ipcMain.off("companion:beginDrag", beginDrag);
    ipcMain.removeHandler("companion:endDrag");
    ipcMain.removeHandler("companion:getLayout");
    ipcMain.off("companion:moveBy", moveBy);
    ipcMain.off("companion:setIgnoreMouse", setIgnoreMouse);
    screen.off("display-removed", updateBounds);
    screen.off("display-metrics-changed", updateBounds);
    topper.dispose();
    companionTopper = undefined;
    companionWindow = null;
    syncMouse = undefined;
    setTrayDesktopPet(false);
    // 外部快捷键（如 Alt+F4 / Cmd+W）关闭浮窗时同步落盘并通知设置页，避免托盘状态失步
    if (!isAppQuitting()) {
      const currentSettings = store.get("companion");
      if (currentSettings.enabled && currentSettings.showAvatar) {
        const nextSettings = { ...currentSettings, showAvatar: false };
        store.set("companion", nextSettings);
        broadcast("companion:configChange", nextSettings);
      }
    }
    cancel();
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/windows/companion/index.html`);
  } else {
    void win.loadFile(join(__dirname, "../renderer/windows/companion/index.html"));
  }
}
