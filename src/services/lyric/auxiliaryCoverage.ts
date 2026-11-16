import type { AuxiliaryLyricSpan, LyricLine } from "@shared/types/lyrics";

/**
 * 统一判断逐字轨道的文本与时间覆盖，整行片段须有明确原词范围
 * @param line - 保持原始时间的主歌词
 * @param spans - 辅助歌词的逐字片段
 * @param text - 辅助轨道应保留的完整文本
 * @param allowUnmapped - 自然译文可省略个别原词，音译仍需覆盖全部原词
 * @returns 文本一致且有明确语义范围或完整时间覆盖时返回 true
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
    ) &&
    (allowUnmapped ||
      words.every(({ index }) => spans.some(({ from, to }) => from! <= index && to! >= index)))
  )
    return true;
  if (
    words.length > 1 &&
    new Set(spans.map((span) => `${span.startTime}:${span.endTime}`)).size < 2
  )
    return false;
  const ranges: { start: number; end: number }[] = [];
  for (const span of spans.slice().sort((a, b) => a.startTime - b.startTime)) {
    const previous = ranges.at(-1);
    if (previous && previous.end >= span.startTime)
      previous.end = Math.max(previous.end, span.endTime);
    else ranges.push({ start: span.startTime, end: span.endTime });
  }
  return (
    words.length > 0 &&
    words.every(({ word }) =>
      ranges.some((range) => range.start <= word.startTime && range.end >= word.endTime),
    )
  );
};
