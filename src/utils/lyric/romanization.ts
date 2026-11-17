import { resolveTimedWordRanges } from "@shared/utils/lyricWordRanges";
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
  const words = line.words.flatMap((word, index) => (word.word.trim() ? [{ ...word, index }] : []));
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
    const part = {
      word: text.slice(start, end),
      startTime: word.startTime,
      endTime: word.endTime,
      from: word.index,
      to: word.index,
    };
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
  for (const word of words) delete word.romanWord;
  const ranges = resolveTimedWordRanges(words, parts);
  if (ranges) {
    let cursor = 0;
    for (const part of ranges) {
      const from = part.from ?? source[cursor].index;
      const to = part.to ?? from;
      words[from].romanWord = part.word.trim();
      while (cursor < source.length && source[cursor].index <= to) cursor++;
    }
    return ranges;
  }
  alignRomanization(words, parts);
  return parts.map(({ from: _from, to: _to, ...part }) => part);
};
