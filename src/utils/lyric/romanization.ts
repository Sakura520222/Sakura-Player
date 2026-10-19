import { alignRomanization } from "lyric-kit";
import type { LyricLine, LyricWord, RomanizationSpan } from "@shared/types/lyrics";

export const ROMANIZATION_LRC_KEY = "sakura-romanization";

/**
 * 优先沿用独立逐字轨道，将完整词内音译按原文本空白恢复成可保存的时间片段
 * @param line - 当前主歌词与已有音译
 * @returns 已有独立轨道或完整词内音译；缺词或文本不一致时不推导
 */
export const getRomanizationSpans = (line: LyricLine): RomanizationSpan[] | undefined => {
  if (line.romanizationWords?.length) return line.romanizationWords;
  const words = line.words.filter((word) => word.word.trim());
  if (!words.length || words.some((word) => !word.romanWord?.trim())) return undefined;
  const text = line.romanLyric || words.map((word) => word.romanWord!.trim()).join(" ");
  if (
    words
      .map((word) => word.romanWord)
      .join("")
      .replace(/\s+/g, "") !== text.replace(/\s+/g, "")
  )
    return undefined;
  const characters = Array.from(text.matchAll(/\S/gu));
  let position = 0;
  let start = 0;
  return words.map((word, index) => {
    position += Array.from(word.romanWord!.replace(/\s+/g, "")).length;
    const end = index === words.length - 1 ? text.length : characters[position].index;
    const part = { word: text.slice(start, end), startTime: word.startTime, endTime: word.endTime };
    start = end;
    return part;
  });
};

/**
 * 恢复音译原词范围，保留原始时间能唯一确定的分组与促音空拍
 * @param words - 保留原始下标的主歌词字词
 * @param parts - 带时间及可选原词范围的音译片段
 * @returns 已恢复范围的音译片段；不能可靠分组时沿用普通逐词匹配
 */
export const alignRomanizationWords = (
  words: LyricWord[],
  parts: RomanizationSpan[],
): RomanizationSpan[] => {
  const source = words.flatMap((word, index) => (word.word.trim() ? [{ word, index }] : []));
  const explicit = parts.some((part) => part.from !== undefined || part.to !== undefined);
  if (!explicit && parts.some((part) => !part.word.trim())) {
    parts = parts.map((part) => ({ ...part }));
    for (let index = parts.length - 2; index >= 0; index--) {
      const part = parts[index];
      if (part.word.trim()) continue;
      const silent = source.filter(
        ({ word }) => word.startTime >= part.startTime && word.endTime <= part.endTime,
      );
      const next = parts[index + 1];
      // 促音可只有空拍，不能把其他缺失读音的空片段当成完整音译
      if (
        silent.length &&
        silent[0].word.startTime === part.startTime &&
        silent.at(-1)!.word.endTime === part.endTime &&
        silent.every(({ word }) => /^[っッ]+$/.test(word.word)) &&
        next.startTime === part.endTime
      ) {
        next.word = part.word + next.word;
        next.startTime = part.startTime;
        parts.splice(index, 1);
      }
    }
  }
  const memo = new Map<string, { ranges: RomanizationSpan[]; count: number }>();

  /**
   * 只接受完整且唯一的连续分组，避免同刻字词在重载时被任意拆配
   * @param position - 当前音译片段下标
   * @param cursor - 下一个尚未覆盖的有效原词位置
   * @returns 完整分组及至多两个候选的数量
   */
  const resolve = (
    position: number,
    cursor: number,
  ): { ranges: RomanizationSpan[]; count: number } => {
    if (position === parts.length) return { ranges: [], count: cursor === source.length ? 1 : 0 };
    const key = `${position}:${cursor}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const part = parts[position];
    const result = { ranges: [] as RomanizationSpan[], count: 0 };
    let startTime = Infinity;
    let endTime = -Infinity;
    for (let end = cursor; end <= source.length - (parts.length - position); end++) {
      startTime = Math.min(startTime, source[end].word.startTime);
      endTime = Math.max(endTime, source[end].word.endTime);
      if (startTime < part.startTime || endTime > part.endTime) break;
      const from = source[cursor].index;
      const to = source[end].index;
      if (
        startTime !== part.startTime ||
        endTime !== part.endTime ||
        (explicit && (from !== (part.from ?? from) || to !== (part.to ?? from)))
      )
        continue;
      const next = resolve(position + 1, end + 1);
      if (!next.count) continue;
      result.ranges = [{ ...part, ...(from !== to ? { from, to } : {}) }, ...next.ranges];
      result.count = Math.min(2, result.count + next.count);
      if (result.count === 2) break;
    }
    memo.set(key, result);
    return result;
  };

  for (const word of words) delete word.romanWord;
  // 旧逐行轨道没有原词范围，整句的首尾时间不能证明已有逐字关联
  const resolved =
    !explicit && parts.length === 1 && source.length > 1 ? { ranges: [], count: 0 } : resolve(0, 0);
  if (resolved.count === 1) {
    let cursor = 0;
    for (const part of resolved.ranges) {
      const from = part.from ?? source[cursor].index;
      const to = part.to ?? from;
      words[from].romanWord = part.word.trim();
      while (cursor < source.length && source[cursor].index <= to) cursor++;
    }
    return resolved.ranges;
  }
  alignRomanization(words, parts);
  return parts.map(({ from: _from, to: _to, ...part }) => part);
};
