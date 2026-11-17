import type { LyricLine } from "@shared/types/lyrics";
import type { AlignmentSourceLine, PrimaryAlignmentResult } from "@shared/types/lyricAlignment";
import { getExistingRomanization } from "./aiGeneration";
import { PRIMARY_ALIGNMENT_MARGIN_MS } from "@shared/constants/lyricAlignment";

/**
 * 收集整首主歌词供重新计算时间，保留稳定行号
 * @param lines - 当前歌曲的原文歌词
 * @returns 可交给声学模型的有界行级输入
 */
export const collectPrimaryAlignmentLines = (lines: LyricLine[]): AlignmentSourceLine[] => {
  const result: AlignmentSourceLine[] = [];
  for (const [id, line] of lines.entries()) {
    const text = line.words.map((word) => word.word).join("");
    if (
      !text.trim() ||
      line.isBG ||
      !Number.isFinite(line.startTime) ||
      !Number.isFinite(line.endTime) ||
      line.startTime < 0 ||
      line.endTime <= line.startTime
    )
      continue;
    if (text.length > 1024) throw new Error("歌词过长，无法进行声学对齐");
    result.push({
      id,
      words: [text],
      primary: {
        startTime: Math.max(0, line.startTime - PRIMARY_ALIGNMENT_MARGIN_MS),
        endTime: line.endTime + PRIMARY_ALIGNMENT_MARGIN_MS,
      },
      translation: line.translatedLyric,
      romanization: getExistingRomanization(line),
    });
  }
  return result;
};

/**
 * 校验声学候选并保留各轨文本，主时间变化时清除依赖旧字词的辅助时间
 * @param line - 待计算时间的主歌词原文
 * @param result - Rust 返回的毫秒时间及评分
 * @returns 新歌词行，仅拒绝改写文本或无效时间，低评分由预览警告提示
 */
export const applyPrimaryAlignment = (
  line: LyricLine,
  result: PrimaryAlignmentResult,
): LyricLine | null => {
  if (
    !collectPrimaryAlignmentLines([line]).length ||
    !Number.isFinite(result.score) ||
    result.score < 0 ||
    result.score > 1 ||
    !Array.isArray(result.words) ||
    result.words.length < 1 ||
    result.words.length > 2048 ||
    result.words.map((word) => word.word).join("") !== line.words.map((word) => word.word).join("")
  )
    return null;
  if (
    result.words.some(
      (word, index) =>
        !word.word.trim() ||
        !Number.isFinite(word.startTime) ||
        !Number.isFinite(word.endTime) ||
        word.startTime < Math.max(0, line.startTime - PRIMARY_ALIGNMENT_MARGIN_MS) ||
        word.endTime > line.endTime + PRIMARY_ALIGNMENT_MARGIN_MS ||
        word.endTime <= word.startTime ||
        (index > 0 && word.startTime < result.words[index - 1].endTime),
    )
  )
    return null;
  const next: LyricLine = {
    ...line,
    translatedLyric:
      line.translatedLyric || line.translationWords?.map((word) => word.word).join("") || "",
    romanLyric: getExistingRomanization(line),
    words: result.words.map((word) => ({ ...word })),
    estimatedTiming: false,
    startTime: Math.min(line.startTime, result.words[0].startTime),
    endTime: Math.max(line.endTime, result.words.at(-1)!.endTime),
  };
  if (
    line.words.length !== result.words.length ||
    line.words.some(
      (word, index) =>
        word.word !== result.words[index].word ||
        word.startTime !== result.words[index].startTime ||
        word.endTime !== result.words[index].endTime,
    )
  ) {
    next.translationWords = undefined;
    next.romanizationWords = undefined;
  } else {
    next.words = line.words.map((word) => ({ ...word }));
  }
  return next;
};
