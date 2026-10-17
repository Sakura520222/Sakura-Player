import type { LyricLine, LyricSpan } from "@shared/types/lyrics";

/**
 * 按时间区间并集判断辅助轨道是否完整，允许一个发音对应多个原词
 * @param line - 保持原始时间的主歌词
 * @param spans - 辅助歌词的逐字片段
 * @param text - 辅助轨道应保留的完整文本
 * @returns 文本一致且覆盖每个有效原词时返回 true
 */
export const hasCompleteAuxiliary = (
  line: LyricLine,
  spans: LyricSpan[] | undefined,
  text: string,
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
  const ranges: { start: number; end: number }[] = [];
  for (const span of spans.slice().sort((a, b) => a.startTime - b.startTime)) {
    const previous = ranges.at(-1);
    if (previous && previous.end >= span.startTime)
      previous.end = Math.max(previous.end, span.endTime);
    else ranges.push({ start: span.startTime, end: span.endTime });
  }
  const words = line.words.filter((word) => word.word.trim());
  return (
    words.length > 0 &&
    words.every((word) =>
      ranges.some((range) => range.start <= word.startTime && range.end >= word.endTime),
    )
  );
};
