import type { LyricLine } from "@shared/types/lyrics";
import { sequenceTranslationWords } from "@shared/utils/lyricTiming";
import type { AlignedTranslation } from "@/services/lyric/aiAlignment";
import { AlignmentDecoder, collectAlignmentLines } from "@/services/lyric/aiAlignment";
import {
  createGenerationPlan,
  GenerationDecoder,
  getExistingRomanization,
  type GeneratedLyric,
  type GenerationOptions,
  type GenerationMode,
} from "@/services/lyric/aiGeneration";

/** 排除空白词占位时间，在原词语义范围内顺排译文的语序冲突片段 */
const createTranslationWords = (line: LyricLine, parts: AlignedTranslation["translation"]) =>
  sequenceTranslationWords(
    parts.map(({ text, from, to }) =>
      line.words.slice(from, to + 1).reduce(
        (span, word) => {
          if (word.word.trim()) {
            span.startTime = Math.min(span.startTime, word.startTime);
            span.endTime = Math.max(span.endTime, word.endTime);
          }
          return span;
        },
        { word: text, startTime: line.words[from].startTime, endTime: line.words[to].endTime },
      ),
    ),
  );

/**
 * 将单词或合并发音映射到原词时间范围，不改变主歌词与注音
 * @param line - 当前主歌词及其时间轴
 * @param parts - 已规范化且完整覆盖的音译范围
 * @param preserveSpacing - 是否沿用已校验的已有文本空白
 * @returns 原词注音和用于副行显示的音译时间片段
 */
const createRomanizedWords = (
  line: LyricLine,
  parts: AlignedTranslation["romanization"],
  preserveSpacing = false,
) => {
  const romanization = new Map(parts.map((word) => [word.index, word.text.trim()]));
  const romanizationWords = parts.map((part, position) => {
    const words = line.words
      .slice(part.index, (part.to ?? part.index) + 1)
      .filter((word) => word.word.trim());
    return {
      word: part.text + (!preserveSpacing && position < parts.length - 1 ? " " : ""),
      startTime: Math.min(...words.map((word) => word.startTime)),
      endTime: Math.max(...words.map((word) => word.endTime)),
    };
  });
  return {
    words: line.words.map((word, index) => ({ ...word, romanWord: romanization.get(index) })),
    romanizationWords,
    romanLyric: romanizationWords
      .map((word) => word.word)
      .join("")
      .trim(),
  };
};

/**
 * 沿用主歌词语义范围顺排译文，音译保留原词时间
 * @param lines - 不可修改的当前主歌词
 * @param results - 已生成的整首翻译和音译
 * @returns 保留原文、注音与声部的新歌词；不完整结果返回 null
 */
export const alignGeneratedLyrics = (
  lines: LyricLine[],
  results: ReadonlyMap<number, AlignedTranslation>,
): LyricLine[] | null => {
  const source = collectAlignmentLines(lines);
  if (!source.length || results.size !== source.length) return null;
  // 应用入口重新校验，避免未来调用方绕过流式解码器写入部分结果。
  let validated: Map<number, AlignedTranslation>;
  try {
    const decoder = new AlignmentDecoder(source);
    for (const [id, value] of results) decoder.push(JSON.stringify({ id, ...value }) + "\n");
    validated = decoder.finish();
  } catch {
    return null;
  }
  return lines.map((line, id) => {
    const result = validated.get(id);
    if (!result) return line;
    const translationWords = createTranslationWords(line, result.translation);
    return {
      ...line,
      ...createRomanizedWords(line, result.romanization),
      translatedLyric: translationWords.map((word) => word.word).join(""),
      translationWords,
    };
  });
};

/**
 * 重新校验后仅应用所选辅助轨道，逐字单选时保留已有文本
 * @param lines - 当前主歌词与已有辅助数据
 * @param results - 覆盖整首有效歌词行的生成结果
 * @param options - 用户勾选的生成项目
 * @param mode - 补齐时保留已有内容，完整生成时重新生成所选轨道
 * @returns 完整新歌词；不完整、改写既有文本或格式无效时返回 null
 */
export const applyGeneratedLyrics = (
  lines: LyricLine[],
  results: ReadonlyMap<number, GeneratedLyric>,
  options: GenerationOptions,
  mode: GenerationMode = "missing",
): LyricLine[] | null => {
  let validated: Map<number, GeneratedLyric>;
  let planned: Map<number, ReturnType<typeof createGenerationPlan>[number]>;
  try {
    const source = createGenerationPlan(lines, options, mode);
    if (!source.length || source.length !== results.size) return null;
    planned = new Map(source.map((line) => [line.id, line]));
    const decoder = new GenerationDecoder(source, options);
    for (const [id, value] of results) decoder.push(JSON.stringify({ id, ...value }) + "\n");
    validated = decoder.finish();
  } catch {
    return null;
  }
  return lines.map((line, id) => {
    const result = validated.get(id);
    if (!result) return line;
    const request = planned.get(id)!;
    const next = { ...line };
    if (Array.isArray(result.translation)) {
      next.translationWords = createTranslationWords(line, result.translation);
      next.translatedLyric =
        !request.options!.translation && request.existingTranslation.trim()
          ? line.translatedLyric
          : next.translationWords.map((word) => word.word).join("");
    } else if (typeof result.translation === "string") {
      next.translatedLyric = result.translation;
      next.translationWords = undefined;
    }
    if (Array.isArray(result.romanization)) {
      Object.assign(
        next,
        createRomanizedWords(
          line,
          result.romanization,
          !request.options!.romanization && !!request.existingRomanization,
        ),
      );
      if (!request.options!.romanization && request.existingRomanization)
        next.romanLyric = getExistingRomanization(line);
    } else if (typeof result.romanization === "string") {
      next.romanLyric = result.romanization;
      next.romanizationWords = undefined;
      next.words = line.words.map((word) => ({ ...word, romanWord: undefined }));
    }
    return next;
  });
};
