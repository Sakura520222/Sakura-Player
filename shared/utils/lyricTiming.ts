import type { LyricSpan } from "../types/lyrics";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * 保留译文语序和有序语义锚点，仅对重排或重叠的连续片段分配顺序时间
 * @param words - 按译文显示顺序排列的语义片段
 * @returns 从左到右、互不倒退的时间片段；已有顺序正确时保留原数组
 */
export const sequenceTranslationWords = (words: LyricSpan[]): LyricSpan[] => {
  if (!words.some((word, index) => index > 0 && word.startTime < words[index - 1].endTime))
    return words;
  const groups: { first: number; last: number; start: number; end: number }[] = [];
  for (const [index, word] of words.entries()) {
    const group = { first: index, last: index, start: word.startTime, end: word.endTime };
    while (groups.length && groups[groups.length - 1].end > group.start) {
      const previous = groups.pop()!;
      group.first = previous.first;
      group.start = Math.min(previous.start, group.start);
      group.end = Math.max(previous.end, group.end);
    }
    groups.push(group);
  }
  const result = words.slice();
  for (const group of groups) {
    if (group.first === group.last) continue;
    const weights = words
      .slice(group.first, group.last + 1)
      .map((word) => Math.max(1, Array.from(graphemes.segment(word.word.trim())).length));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let weight = 0;
    let startTime = group.start;
    for (let index = group.first; index <= group.last; index++) {
      weight += weights[index - group.first];
      const endTime =
        index === group.last
          ? group.end
          : Math.max(
              startTime,
              Math.min(
                group.end,
                Math.round(group.start + ((group.end - group.start) * weight) / total),
              ),
            );
      result[index] = { ...words[index], startTime, endTime };
      startTime = endTime;
    }
  }
  return result;
};
