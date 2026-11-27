/**
 * 播放控制聚合入口
 *
 * 把"外部来源"（系统媒体、HTTP/WS 外部 API、插件）发起的播放控制
 * 收敛到一处：引擎直控 + 必要时通知渲染层补记账。
 */

import { randomUUID } from "node:crypto";
import { getMainWindow } from "@main/window";
import { queueQuerySchema } from "@main/services/music";
import {
  beginPlaybackOperation,
  playbackRevision,
  setCueTrack,
  toDisplayDurationMs,
  toDisplayPositionMs,
  toEnginePositionMs,
} from "./playbackTimeline";
import { notifyDiscontinuity } from "@main/services/nowPlaying";
import { getPlayer } from "@main/services/engine";
import { cancelPreparedTrack, setCurrentTransitionRange } from "@main/services/playerPreload";
import { cancelPendingReinit } from "@main/services/device";
import * as mediaService from "@main/services/media";
import * as streamingPlayback from "@main/services/streaming/playback";
import * as neteaseScrobble from "@main/services/neteaseScrobble";
import * as lastfm from "@main/services/lastfm";
import { sendToMain } from "@main/utils/broadcast";
import { toMs } from "@main/utils/time";
import type { ShuffleMode, RepeatMode, Track, PlayerState } from "@shared/types/player";
import type {
  PlaybackStatusSnapshot,
  PlaybackQueueOptions,
  PlaybackQueueSnapshot,
} from "@shared/types/music";
import { getTrayPlayMode } from "@main/services/tray";

let currentIndex = -1;

/**
 * 跳转到指定播放位置，同时使依赖旧位置的工作失效并同步流媒体与系统媒体时间轴
 * @param positionMs - 目标位置（毫秒）
 * @returns 引擎完成跳转的结果
 */
const seek = async (positionMs: number): Promise<void> => {
  if (!Number.isFinite(positionMs) || positionMs < 0) {
    throw new Error("无效的跳转位置");
  }
  const inst = getPlayer();
  const status = inst.getStatus();
  const seq = beginPlaybackOperation();
  notifyDiscontinuity();
  if (status.state === "idle" || status.state === "stopped") return;
  const durationMs = toDisplayDurationMs(toMs(status.duration));
  const targetMs = durationMs > 0 ? Math.min(durationMs, positionMs) : positionMs;
  sendToMain("player:event", { type: "seek", data: { position: targetMs } });
  try {
    await inst.seek(toEnginePositionMs(targetMs) / 1000);
    if (seq !== playbackRevision || inst !== getPlayer()) return;
    streamingPlayback.onStreamingSeek(targetMs);
    mediaService.setTimeline({
      currentMs: targetMs,
      totalMs: toDisplayDurationMs(toMs(inst.getDuration())),
      seeked: true,
    });
  } catch (error) {
    if (seq === playbackRevision && inst === getPlayer()) {
      const current = inst.getStatus();
      sendToMain("player:event", {
        type: "status",
        data: {
          state: current.state as PlayerState,
          position: toDisplayPositionMs(toMs(current.position)),
          duration: toDisplayDurationMs(toMs(current.duration)),
          volume: inst.getVolume(),
          speed: inst.getSpeed(),
        },
      });
    }
    throw error;
  }
};

/**
 * 向主窗口按需读取队列，超时自动移除响应监听
 * @param options - 队列偏移与返回条数
 * @returns 当前播放顺序的队列分页及播放索引
 */
const getQueue = async (options: PlaybackQueueOptions = {}): Promise<PlaybackQueueSnapshot> => {
  const query = queueQuerySchema.parse(options);
  const window = getMainWindow();
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    throw new Error("Playback window is unavailable");
  }
  const requestId = randomUUID();
  const channel = `player:queue-response:${requestId}`;
  const ipc = window.webContents.ipc;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipc.removeListener(channel, receive);
      reject(new Error("Reading the playback queue timed out"));
    }, 5000);
    /**
     * 完成当前查询并释放超时任务
     * @param _event - 主窗口的进程通信事件
     * @param snapshot - 渲染进程读取的队列快照
     */
    const receive = (_event: Electron.IpcMainEvent, snapshot: PlaybackQueueSnapshot): void => {
      clearTimeout(timer);
      resolve(snapshot);
    };
    ipc.once(channel, receive);
    window.webContents.send("player:event", { type: "getQueue", data: { requestId, ...query } });
  });
};

export const playerControl = {
  getQueue,
  /**
   * 保存主窗口同步的队列索引，供各外部入口共用
   * @param index - 当前队列索引，无当前队列项时为 -1
   */
  syncQueueIndex: (index: number): void => {
    currentIndex = index;
  },
  /**
   * 读取播放状态并统一时间单位为毫秒
   * @returns 播放状态、当前队列索引、音量与播放模式
   */
  getStatus: (): PlaybackStatusSnapshot => {
    const status = getPlayer().getStatus();
    return {
      state: status.state as PlayerState,
      positionMs: toDisplayPositionMs(toMs(status.position)),
      durationMs: toDisplayDurationMs(toMs(status.duration)),
      volume: status.volume,
      isFinished: status.isFinished,
      currentIndex,
      ...getTrayPlayMode(),
    };
  },
  play: (): void =>
    void getPlayer()
      .play()
      .catch(() => {}),
  pause: (): void => getPlayer().pause(),
  /** 停止播放并释放流媒体会话、预加载槽位与待重连状态 */
  stop: (): void => {
    beginPlaybackOperation();
    notifyDiscontinuity();
    setCueTrack(null);
    void streamingPlayback.stopStreamingPlayback();
    cancelPreparedTrack();
    cancelPendingReinit();
    setCurrentTransitionRange();
    neteaseScrobble.onStopped();
    lastfm.onStopped();
    getPlayer().stop();
  },
  next: (): void => sendToMain("player:event", { type: "next" }),
  prev: (): void => sendToMain("player:event", { type: "prev" }),
  setShuffle: (mode: ShuffleMode): void =>
    sendToMain("player:event", { type: "setShuffle", data: { mode } }),
  setRepeat: (mode: RepeatMode): void =>
    sendToMain("player:event", { type: "setRepeat", data: { mode } }),
  playTrack: (track: Track): void =>
    sendToMain("player:event", { type: "playTrack", data: { track } }),
  addToQueue: (tracks: Track[], position: "next" | "end"): void =>
    sendToMain("player:event", { type: "addToQueue", data: { tracks, position } }),
  seek,
  setVolume: (volume: number): void => getPlayer().setVolume(volume),
  /** 当前播放进度（毫秒） */
  getPosition: (): number => toDisplayPositionMs(toMs(getPlayer().getPosition())),
};
