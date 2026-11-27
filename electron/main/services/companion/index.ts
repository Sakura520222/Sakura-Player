import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import type { CompanionMessage, CompanionState, CompanionTheme } from "@shared/types/companion";
import { COMPANION_REPLY_BUBBLE_SECONDS } from "@shared/types/companion";
import { store } from "@main/store";
import { getMainWindow } from "@main/window";
import { getLocale } from "@main/utils/i18n";
import { isAppQuitting } from "@main/utils/lifecycle";
import { broadcast, sendToMain } from "@main/utils/broadcast";
import { getCompanionWindow, syncCompanionWindow } from "@main/window/companion";
import type { PlayerState } from "@shared/types/player";
import { getSongHighlight } from "@main/services/songHighlight";
import * as nowPlaying from "@main/services/nowPlaying";
import { CompanionScheduler } from "./scheduler";
import { getSongHighlightKey } from "@shared/utils/songHighlight";
import { companionLabel } from "@main/services/mcp/musicContext";

const scheduler = new CompanionScheduler();
const messages: CompanionMessage[] = [];
let active: AbortController | undefined;
let proactiveRequest = false;
let typing = false;
let draft = "";
let error: string | null = null;
let highlightKey = "";
let playbackState: PlayerState = "idle";
let annotationLoad: object | undefined;
let subscriptions: (() => void)[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

/** 构建聊天快照，仅传递用于展示的曲目信息 */
function snapshot(): CompanionState {
  const { track } = nowPlaying.lightSnapshot();
  const { replyBubble, replyBubbleSeconds } = store.get("companion");
  const { min, max, default: defaultSeconds } = COMPANION_REPLY_BUBBLE_SECONDS;
  return {
    replyBubble: replyBubble ?? true,
    replyBubbleSeconds: Number.isFinite(replyBubbleSeconds)
      ? Math.min(max, Math.max(min, Math.round(replyBubbleSeconds)))
      : defaultSeconds,
    messages,
    draft,
    pending: !!active,
    error,
    locale: getLocale(),
    track: track && {
      title: track.title,
      artists: track.artists.map((artist) => artist.name).join(" / "),
      cover: track.cover,
    },
  };
}

/** 向角色窗口推送会话快照，并撤销尚未送出的旧草稿 */
export function publishCompanionState(): void {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  getCompanionWindow()?.webContents.send("companion:state", snapshot());
}

/** 放弃旧请求与未发布的流式文本，并重新等待稳定播放 */
export function cancelCompanion(): void {
  scheduler.interrupt();
  if (!active) return;
  active.abort();
  active = undefined;
  draft = "";
  publishCompanionState();
}

/**
 * 在会话内复用近期消息，仅保留有限条完整回答
 * @param message - 当前用户输入或模型回答
 */
function append(message: CompanionMessage): void {
  messages.push(message);
  if (messages.length > 60) messages.shift();
}

/**
 * 启动一轮对话，所有流式回调和最终回复受同一取消信号约束
 * @param prompt - 用户输入或播放事件描述
 * @param proactive - 是否为主动发言
 */
async function respond(prompt: string, proactive: boolean): Promise<void> {
  const request = new AbortController();
  active = request;
  proactiveRequest = proactive;
  const history = messages.slice(-16);
  const { track, position } = nowPlaying.lightSnapshot();
  if (!proactive) append({ id: randomUUID(), role: "user", text: prompt, proactive });
  error = null;
  draft = "";
  publishCompanionState();
  try {
    const { runCompanionAgent } = await import("@main/services/ai/companion");
    request.signal.throwIfAborted();
    const result = await runCompanionAgent(
      {
        prompt,
        proactive,
        history,
        context: JSON.stringify({
          language: getLocale(),
          title: track && companionLabel(track.title),
          artists: track?.artists
            .slice(0, 16)
            .map((artist) => companionLabel(artist.name))
            .filter(Boolean),
          album: track?.album && companionLabel(track.album.name),
          positionMs: position,
        }),
      },
      request.signal,
      (text) => {
        if (active !== request || proactive) return;
        draft = text;
        flushTimer ??= setTimeout(() => {
          flushTimer = undefined;
          const win = getCompanionWindow();
          if (win?.isVisible()) win.webContents.send("companion:draft", draft);
        }, 100);
      },
    );
    if (active !== request || !result.text.trim()) return;
    const message: CompanionMessage = {
      id: randomUUID(),
      role: "assistant",
      text: result.text.trim(),
      proactive,
      usage: result.usage ?? undefined,
    };
    append(message);
    scheduler.defer(Date.now());
    if (store.get("companion.danmaku") && getMainWindow()?.isVisible()) {
      sendToMain("companion:danmaku", message);
    }
  } catch (cause) {
    if (active === request) error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (active === request) {
      active = undefined;
      draft = "";
      publishCompanionState();
    }
  }
}

/** 元数据更新时重新匹配标注，保留本轮播放已经触发的事件和正在进行的对话 */
function syncTrack(): void {
  const { track } = nowPlaying.lightSnapshot();
  const key = getSongHighlightKey(track);
  if (key !== highlightKey) {
    annotationLoad = undefined;
    scheduler.setHighlights([]);
    highlightKey = key;
  }
  publishCompanionState();
}

/** 按播放状态控制主动事件；只有稳定的新曲才查询标注 */
function subscribePlayback(): void {
  playbackState = nowPlaying.lightSnapshot().state;
  subscriptions = [
    nowPlaying.onTrackChange(() => {
      cancelCompanion();
      scheduler.changeTrack();
      error = null;
    }),
    nowPlaying.onLyricChange(syncTrack),
    nowPlaying.onDiscontinuity(cancelCompanion),
    nowPlaying.onPositionSync((anchor) => {
      const previous = playbackState;
      playbackState = anchor.state;
      if (!anchor.playing) {
        if (previous !== playbackState) cancelCompanion();
        return;
      }
      if (!highlightKey || !store.get("companion.proactive")) return;
      const now = Date.now();
      if (!scheduler.observePlaying(now)) return;
      if (!annotationLoad) {
        const { track } = nowPlaying.lightSnapshot();
        if (!track) return;
        const token = {};
        annotationLoad = token;
        void getSongHighlight(track)
          .then((result) => {
            if (annotationLoad === token && result.ok)
              scheduler.setHighlights(result.data?.segments ?? []);
          })
          .catch(() => {});
      }
      const event = scheduler.takeEvent(now, anchor.position, !!active || typing);
      if (!event) return;
      const reason = {
        track: "新曲已稳定播放",
        chorus: "播放进入平台标注的副歌",
        climax: "播放进入平台标注的高潮",
      }[event];
      void respond(reason, true);
    }),
  ];
  syncTrack();
}

/** 停用或退出时先撤销播放监听，再清理待处理请求和本次对话 */
export function disposeCompanion(): void {
  for (const unsubscribe of subscriptions) unsubscribe();
  subscriptions = [];
  cancelCompanion();
  messages.length = 0;
  error = null;
  typing = false;
  highlightKey = "";
  annotationLoad = undefined;
  scheduler.changeTrack();
}

/**
 * 应用设置、重置或导入，停用时释放会话与播放订阅
 * @param keyPath - 单项设置路径，省略时刷新全组配置
 */
export function syncCompanionConfig(keyPath = "companion"): void {
  const settings = store.get("companion");
  if (settings.enabled && !subscriptions.length) subscribePlayback();
  if (!settings.enabled) disposeCompanion();
  else if (!settings.proactive && active && proactiveRequest) cancelCompanion();
  syncCompanionWindow(() => {
    typing = false;
    cancelCompanion();
  });
  if (
    keyPath === "companion" ||
    keyPath === "companion.replyBubble" ||
    keyPath === "companion.replyBubbleSeconds"
  ) {
    publishCompanionState();
  }
}

/**
 * 切换桌面宠物显示状态：未启用陪伴时一并开启，关闭时仅隐藏桌面角色并保留陪伴配置
 * @returns 切换后桌面宠物是否处于显示状态
 */
export function toggleDesktopPet(): boolean {
  if (isAppQuitting()) return false;
  const settings = store.get("companion");
  const open = Boolean(getCompanionWindow()) || (settings.enabled && settings.showAvatar);
  const next = open
    ? { ...settings, showAvatar: false }
    : { ...settings, enabled: true, showAvatar: true };
  store.set("companion", next);
  syncCompanionConfig("companion");
  broadcast("companion:configChange", store.get("companion"));
  return !open;
}

/** 接受陪伴窗口发起的聊天请求，应用退出时释放活动请求 */
export function registerCompanionIpc(): void {
  let theme: CompanionTheme | null = null;
  ipcMain.on("companion:setTheme", (event, next: CompanionTheme) => {
    if (event.sender !== getMainWindow()?.webContents) return;
    theme = next;
    getCompanionWindow()?.webContents.send("companion:theme", next);
  });
  ipcMain.handle("companion:getTheme", (event) =>
    event.sender === getCompanionWindow()?.webContents ? theme : null,
  );
  ipcMain.handle("companion:getState", (event) => {
    if (event.sender !== getCompanionWindow()?.webContents) throw new Error("无权访问陪伴会话");
    return snapshot();
  });
  ipcMain.on("companion:setTyping", (event, value: boolean) => {
    if (event.sender !== getCompanionWindow()?.webContents) return;
    typing = value === true;
    if (typing && active && proactiveRequest) cancelCompanion();
  });
  ipcMain.handle("companion:send", async (event, text: unknown) => {
    if (
      event.sender !== getCompanionWindow()?.webContents ||
      !store.get("companion.enabled") ||
      isAppQuitting()
    )
      return;
    if (typeof text !== "string" || !text.trim() || text.length > 4000) return;
    if (active && !proactiveRequest) return;
    cancelCompanion();
    typing = false;
    scheduler.defer(Date.now());
    await respond(text.trim(), false);
  });
}
