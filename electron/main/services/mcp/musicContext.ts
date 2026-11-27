import { pickPrimaryIndex } from "lyric-kit";
import type { NowPlayingSnapshot } from "@shared/types/nowPlaying";

export { companionLabel } from "../music/metadata";

/**
 * 从当前播放快照读取有限的主歌词行，使用与桌面歌词一致的偏移和重叠行选择规则
 * @param snapshot - 当前歌曲、解析歌词及播放锚点
 * @param radius - 当前行前后各保留的行数
 * @returns 播放位置、当前行索引和带毫秒时间戳的歌词片段
 */
export const getLyricContext = (snapshot: NowPlayingSnapshot, radius: number) => {
  const { track, lyric, position, lyricOffsetMs, state } = snapshot;
  const lines = lyric.filter((line) => !line.isBG);
  const time = position + lyricOffsetMs;
  const index = pickPrimaryIndex(lines, time);
  const start = Math.max(0, index - radius);
  return {
    title: track?.title ?? null,
    state,
    positionMs: position,
    lyricOffsetMs,
    currentIndex: index,
    lines: lines.slice(start, index + radius + 1).map((line, offset) => ({
      index: start + offset,
      startMs: line.startTime,
      endMs: line.endTime,
      text: line.words
        .map((word) => word.word)
        .join("")
        .slice(0, 320),
    })),
  };
};
