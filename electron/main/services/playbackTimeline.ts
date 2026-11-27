import type { Track } from "@shared/types/player";

interface CueRange {
  startMs: number;
  durationMs: number;
}

/** 准备、加载或跳转所依赖的播放轮次，供所有播放控制入口校验迟到的结果 */
export let playbackRevision = 0;

/**
 * 新的播放操作使旧的加载、交接和媒体更新失效
 * @returns 当前操作的版本
 */
export function beginPlaybackOperation(): number {
  return ++playbackRevision;
}

/** 当前引擎加载的分轨范围，IPC、系统媒体和 MCP 共用 */
export let activeCueRange: CueRange | null = null;

/**
 * 在加载或交接歌曲时同步有效的 CUE 范围，停止时清除
 * @param track - 正在装载的曲目
 * @returns 当前曲目的分轨范围
 */
export function setCueTrack(track: Track | null | undefined): CueRange | null {
  const start = track?.cueStartMs;
  const end = track?.cueEndMs;
  activeCueRange =
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start
      ? { startMs: start, durationMs: end - start }
      : null;
  return activeCueRange;
}

/**
 * 将引擎的文件位置换算为分轨位置
 * @param positionMs - 文件内毫秒位置
 * @returns 曲目内的毫秒位置
 */
export function toDisplayPositionMs(positionMs: number): number {
  if (!activeCueRange) return positionMs;
  return Math.max(0, Math.min(activeCueRange.durationMs, positionMs - activeCueRange.startMs));
}

/**
 * 将文件时长换算为当前曲目时长
 * @param durationMs - 文件毫秒时长
 * @returns 展示给调用者的曲目时长
 */
export const toDisplayDurationMs = (durationMs: number): number =>
  activeCueRange?.durationMs ?? durationMs;

/**
 * 将曲目内跳转位置换算为引擎文件位置
 * @param positionMs - 曲目内毫秒位置
 * @returns 文件内毫秒位置
 */
export const toEnginePositionMs = (positionMs: number): number =>
  activeCueRange
    ? activeCueRange.startMs + Math.max(0, Math.min(activeCueRange.durationMs, positionMs))
    : Math.max(0, positionMs);
