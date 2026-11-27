import { screen, type BrowserWindow } from "electron";

/** 悬浮层统一使用最高非独占置顶层级，避免被普通置顶窗或全屏切换轻易压下 */
export const OVERLAY_TOP_LEVEL = "screen-saver" as const;

/** Windows 周期复核间隔，及时从 Win+D、全屏应用或截图覆盖层切回后恢复置顶 */
const WIN_TOPMOST_WATCHDOG_MS = 1500;
/** 连续最小化恢复的最小间隔，防止与系统独占全屏争夺状态时死循环 */
const MINIMIZE_RECOVER_COOLDOWN_MS = 250;
/** 窗口稳定可见超过该时长后重置连续恢复计数 */
const MINIMIZE_RESET_MS = 2500;
/** 单轮允许连续尝试恢复意外最小化的最大次数 */
const MAX_MINIMIZE_ATTEMPTS = 3;

interface KeepEntry {
  win: BrowserWindow;
  shouldBeVisible: () => boolean;
  isEnabled: () => boolean;
  appliedWorkspaceVisible: boolean | undefined;
  lastMinimizeRecoverAt: number;
  minimizeAttempts: number;
}

const activeKeepers = new Set<KeepEntry>();
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let displayListenerBound = false;

/**
 * 在 Windows 上返回工具窗口类型（WS_EX_TOOLWINDOW），避免被 Win+D 当作普通应用最小化及污染 Alt+Tab
 * @returns Windows 平台附加的窗口类型配置
 */
export function overlayWindowType(): { type: "toolbar" } | Record<string, never> {
  return process.platform === "win32" ? { type: "toolbar" } : {};
}

/**
 * 检查是否有其他受管理的悬浮窗正持有焦点，避免失焦复核时互相抢夺 Z-order
 * @param current - 当前正在处理失焦的悬浮窗记录
 * @returns 是否存在其他聚焦中的悬浮窗
 */
function hasOtherFocusedOverlay(current: KeepEntry): boolean {
  for (const other of activeKeepers) {
    if (other !== current && !other.win.isDestroyed() && other.win.isFocused()) return true;
  }
  return false;
}

/**
 * 在非 Windows 平台按需同步跨工作区与全屏空间可见性，仅状态变化时调用避免触发 macOS Dock 闪烁
 * @param entry - 已注册的悬浮窗口状态
 * @param nextEnabled - 目标置顶状态
 */
function syncWorkspaceVisibility(entry: KeepEntry, nextEnabled: boolean): void {
  if (process.platform === "win32") return;
  if (entry.appliedWorkspaceVisible === undefined && !nextEnabled) return;
  if (entry.appliedWorkspaceVisible === nextEnabled) return;
  entry.appliedWorkspaceVisible = nextEnabled;
  entry.win.setVisibleOnAllWorkspaces(nextEnabled, { visibleOnFullScreen: nextEnabled });
}

/**
 * 尝试无焦点恢复被系统意外最小化的悬浮窗，并限制连续重试避免与系统争夺状态
 * @param entry - 已注册的悬浮窗口状态
 * @returns 是否可以继续执行置顶抬升
 */
function recoverMinimizedIfAllowed(entry: KeepEntry): boolean {
  const { win } = entry;
  const now = Date.now();
  if (!win.isMinimized()) {
    if (entry.minimizeAttempts > 0 && now - entry.lastMinimizeRecoverAt >= MINIMIZE_RESET_MS) {
      entry.minimizeAttempts = 0;
    }
    return win.isVisible();
  }
  if (now - entry.lastMinimizeRecoverAt >= MINIMIZE_RESET_MS) entry.minimizeAttempts = 0;
  if (
    entry.minimizeAttempts >= MAX_MINIMIZE_ATTEMPTS ||
    now - entry.lastMinimizeRecoverAt < MINIMIZE_RECOVER_COOLDOWN_MS
  ) {
    return false;
  }
  entry.lastMinimizeRecoverAt = now;
  entry.minimizeAttempts += 1;
  // Windows 下 showInactive（SW_SHOWNOACTIVATE）可直接还原最小化窗口且不抢占当前焦点
  win.showInactive();
  return !win.isMinimized() && win.isVisible();
}

/**
 * 将处于可见态或被系统意外最小化的置顶窗口恢复到顶层，不抢占当前输入焦点
 * @param entry - 已注册的悬浮窗口状态
 * @param skipWhenFocused - 窗口已聚焦时跳过周期复核，避免压过输入法候选窗
 */
function reinforceEntry(entry: KeepEntry, skipWhenFocused: boolean): void {
  const { win } = entry;
  if (win.isDestroyed() || !entry.isEnabled() || !entry.shouldBeVisible()) return;
  if (skipWhenFocused && win.isFocused()) return;
  if (!recoverMinimizedIfAllowed(entry)) return;
  win.setAlwaysOnTop(true, OVERLAY_TOP_LEVEL);
}

/** 显示器分辨率或布局变化时复核全部已启用的悬浮置顶窗口 */
function reinforceAllOnDisplayChange(): void {
  for (const entry of activeKeepers) reinforceEntry(entry, false);
}

/** 按当前活跃置顶窗口数量启停共享复核定时器与显示器监听，全隐藏或停用时不留空转计时器 */
function syncWatchdog(): void {
  let hasActiveVisible = false;
  for (const entry of activeKeepers) {
    const { win } = entry;
    if (win.isDestroyed() || !entry.isEnabled() || !entry.shouldBeVisible()) continue;
    if (win.isVisible() || win.isMinimized()) {
      hasActiveVisible = true;
      break;
    }
  }

  if (process.platform === "win32" && hasActiveVisible) {
    watchdogTimer ??= setInterval(() => {
      for (const entry of activeKeepers) reinforceEntry(entry, true);
    }, WIN_TOPMOST_WATCHDOG_MS);
  } else if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  if (activeKeepers.size > 0 && !displayListenerBound) {
    screen.on("display-metrics-changed", reinforceAllOnDisplayChange);
    screen.on("display-added", reinforceAllOnDisplayChange);
    screen.on("display-removed", reinforceAllOnDisplayChange);
    displayListenerBound = true;
  } else if (activeKeepers.size === 0 && displayListenerBound) {
    screen.off("display-metrics-changed", reinforceAllOnDisplayChange);
    screen.off("display-added", reinforceAllOnDisplayChange);
    screen.off("display-removed", reinforceAllOnDisplayChange);
    displayListenerBound = false;
  }
}

export interface AlwaysOnTopKeeper {
  /** 同步最新置顶开关与工作区可见性 */
  sync: (enabled: boolean) => void;
  /** 窗口展示后立即提升到最高悬浮层级 */
  elevate: () => void;
  /** 仅按最新逻辑可见性刷新共享复核器，不重复写入原生置顶属性 */
  refresh: () => void;
  /** 窗口关闭时释放所有监听并回收共享复核器 */
  dispose: () => void;
}

const NOOP_KEEPER: AlwaysOnTopKeeper = {
  sync: () => {},
  elevate: () => {},
  refresh: () => {},
  dispose: () => {},
};

/**
 * 为桌面悬浮窗维持全局置顶：统一 screen-saver 层级、全工作区可见，并在 Windows 下从 Win+D、全屏与截图覆盖后自动恢复
 * @param win - 目标悬浮窗口
 * @param options - 初始置顶状态与逻辑可见性判断
 * @returns 同步、主动提升、刷新与销毁控制器
 */
export function createAlwaysOnTopKeeper(
  win: BrowserWindow,
  options: { enabled: boolean; shouldBeVisible?: () => boolean },
): AlwaysOnTopKeeper {
  if (win.isDestroyed()) return NOOP_KEEPER;

  let enabled = options.enabled;
  let disposed = false;
  const shouldBeVisible = options.shouldBeVisible ?? (() => true);
  const entry: KeepEntry = {
    win,
    shouldBeVisible,
    isEnabled: () => enabled,
    appliedWorkspaceVisible: undefined,
    lastMinimizeRecoverAt: 0,
    minimizeAttempts: 0,
  };
  activeKeepers.add(entry);

  /**
   * 将当前置顶设置应用到窗口与跨工作区策略
   * @param nextEnabled - 是否启用全局置顶
   */
  const apply = (nextEnabled: boolean): void => {
    enabled = nextEnabled;
    if (disposed || win.isDestroyed()) return;
    win.setAlwaysOnTop(enabled, OVERLAY_TOP_LEVEL);
    syncWorkspaceVisibility(entry, enabled);
    syncWatchdog();
  };

  /** 窗口显示或恢复后重新抬升置顶层级 */
  const elevate = (): void => {
    if (disposed || win.isDestroyed()) return;
    if (enabled && shouldBeVisible()) {
      syncWorkspaceVisibility(entry, true);
      reinforceEntry(entry, false);
    }
    syncWatchdog();
  };

  /** 失焦后在微任务中复核置顶，防止切到其他全屏/置顶窗后被压下，但不与同伴悬浮窗抢层 */
  const onBlur = (): void => {
    if (!enabled || process.platform !== "win32") return;
    queueMicrotask(() => {
      if (!disposed && !hasOtherFocusedOverlay(entry)) reinforceEntry(entry, true);
    });
  };

  /** 拦截系统（如 Win+D）对已显示悬浮窗发起的意外最小化并无焦点恢复 */
  const onMinimize = (): void => {
    if (disposed || !enabled || !shouldBeVisible() || process.platform !== "win32") return;
    queueMicrotask(() => {
      if (disposed || win.isDestroyed() || !enabled || !shouldBeVisible() || !win.isMinimized()) {
        return;
      }
      reinforceEntry(entry, false);
      syncWatchdog();
    });
  };

  /** 窗口隐藏后刷新共享复核定时器状态 */
  const onHide = (): void => {
    syncWatchdog();
  };

  /** 释放全部窗口监听与共享复核登记 */
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    activeKeepers.delete(entry);
    if (!win.isDestroyed()) {
      win.off("show", elevate);
      win.off("restore", elevate);
      win.off("hide", onHide);
      win.off("blur", onBlur);
      win.off("minimize", onMinimize);
      win.off("closed", dispose);
    }
    syncWatchdog();
  };

  win.on("show", elevate);
  win.on("restore", elevate);
  win.on("hide", onHide);
  win.on("blur", onBlur);
  win.on("minimize", onMinimize);
  win.once("closed", dispose);

  apply(enabled);
  return { sync: apply, elevate, refresh: syncWatchdog, dispose };
}
