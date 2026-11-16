import { applyTimestampOffset, parseLyric } from "lyric-kit";
import type { LyricInput, LyricLine } from "@shared/types/lyrics";
import { AUXILIARY_TRACKS, restoreAuxiliaryTracks } from "@shared/utils/lyricAuxiliary";
import { readTtmlAuxiliary, readTtmlDocument, restoreTtmlWords } from "@shared/utils/lyricTtml";
import { applyTimedAuxiliary } from "./auxiliary";

/**
 * 解析下载歌词的正文、辅助轨道及时间校正，保留与播放相同的轨道结构
 * @param input - 原歌词、配对轨道及媒体服务器时间校正
 * @returns 解析后的歌曲歌词，或无可用歌词时返回空数组
 */
export const parseDownloadLyrics = (input: LyricInput & { timeShiftMs?: number }): LyricLine[] => {
  const lines: LyricLine[] = parseLyric(input).lines;
  if (input.format === "ttml") {
    const doc = readTtmlDocument(input.content);
    restoreTtmlWords(doc, lines);
    readTtmlAuxiliary(doc, lines, "", input);
  }
  applyTimedAuxiliary(lines, input);
  restoreAuxiliaryTracks(lines, input.auxiliary);
  if (input.timeShiftMs) {
    applyTimestampOffset(lines, input.timeShiftMs);
    for (const line of lines)
      for (const [, , field] of AUXILIARY_TRACKS) {
        line[field] = line[field]?.map((part) => ({
          ...part,
          startTime: Math.max(0, part.startTime + input.timeShiftMs!),
          endTime: Math.max(0, part.endTime + input.timeShiftMs!),
        }));
      }
  }
  return lines;
};
