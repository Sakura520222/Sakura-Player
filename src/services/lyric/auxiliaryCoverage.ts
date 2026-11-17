import type { AuxiliaryLyricSpan, LyricLine } from "@shared/types/lyrics";
import { resolveTimedWordRanges } from "@shared/utils/lyricWordRanges";

/**
 * 音译须与当前字词形成唯一完整关联，译文允许已声明范围的语义省略
 * @param line - 保持原始时间的主歌词
 * @param spans - 辅助歌词的逐字片段
 * @param text - 辅助轨道应保留的完整文本
 * @param allowUnmapped - 自然译文可省略个别原词，音译仍需覆盖全部原词
 * @returns 音译关联完整或译文语义范围有效时返回 true
 */
export const hasCompleteAuxiliary = (
  line: LyricLine,
  spans: AuxiliaryLyricSpan[] | undefined,
  text: string,
  allowUnmapped = false,
): boolean => {
  if (
    !text.trim() ||
    !spans?.length ||
    spans.some(
      (span) =>
        !span.word.trim() ||
        !Number.isFinite(span.startTime) ||
        !Number.isFinite(span.endTime) ||
        span.endTime < span.startTime,
    ) ||
    spans
      .map((span) => span.word)
      .join("")
      .replace(/\s+/g, "") !== text.replace(/\s+/g, "")
  )
    return false;
  if (!allowUnmapped) return resolveTimedWordRanges(line.words, spans) !== undefined;
  const words = line.words.flatMap((word, index) => (word.word.trim() ? [{ word, index }] : []));
  if (
    words.length &&
    spans.every(
      ({ from, to }) =>
        from !== undefined &&
        to !== undefined &&
        Number.isSafeInteger(from) &&
        Number.isSafeInteger(to) &&
        from >= 0 &&
        to >= from &&
        to < line.words.length &&
        words.some(({ index }) => index >= from && index <= to),
    )
  )
    return true;
  return (
    resolveTimedWordRanges(
      line.words,
      spans.toSorted(
        (left, right) => left.startTime - right.startTime || left.endTime - right.endTime,
      ),
    ) !== undefined
  );
};
