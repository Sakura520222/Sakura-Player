import type { LyricLine, LyricSpan } from "@shared/types/lyrics";
import type {
  AlignmentPart,
  AlignmentLineResult,
  AlignmentSourceLine,
  AlignmentTrackResult,
} from "@shared/types/lyricAlignment";
import { getExistingRomanization, type GeneratedLyric } from "./aiGeneration";
import { hasCompleteAuxiliary } from "./auxiliaryCoverage";
import { applyLyricResult } from "@/utils/lyric/alignment";

/**
 * 收集真实逐字主歌词的辅助文本，按选择保留或重做已有完整对齐
 * @param lines - 当前显示的歌词快照
 * @param realignExisting - 是否包含已有完整逐字对齐的辅助轨道
 * @returns 带稳定行号的有界对齐输入
 */
export const collectLocalAlignmentLines = (
  lines: LyricLine[],
  realignExisting = false,
): AlignmentSourceLine[] => {
  const result: AlignmentSourceLine[] = [];
  let characters = 0;
  for (const [id, line] of lines.entries()) {
    const words = line.words.filter((word) => word.word.trim());
    if (
      words.length < 2 ||
      words.length > 256 ||
      words.some(
        (word) =>
          !Number.isFinite(word.startTime) ||
          !Number.isFinite(word.endTime) ||
          word.startTime < 0 ||
          word.endTime < word.startTime,
      ) ||
      new Set(words.map((word) => `${word.startTime}:${word.endTime}`)).size < 2
    )
      continue;
    const source = {
      id,
      words: line.words.map((word) => word.word),
      ...(line.words.some((word) => word.ruby?.length)
        ? { readings: line.words.map((word) => word.ruby?.map((ruby) => ruby.word).join("") ?? "") }
        : {}),
      translation: line.translatedLyric,
      romanization: getExistingRomanization(line),
    };
    if (!realignExisting) {
      for (const [field, spans] of [
        ["translation", line.translationWords],
        [
          "romanization",
          line.romanizationWords?.length
            ? line.romanizationWords
            : words.map((word) => ({ ...word, word: word.romanWord ?? "" })),
        ],
      ] as const) {
        // 整行时间即使覆盖所有原词也不是逐字；词内音译还须与当前整行文本一致
        if (
          spans &&
          new Set(spans.map((span) => `${span.startTime}:${span.endTime}`)).size > 1 &&
          hasCompleteAuxiliary(line, spans, source[field])
        )
          source[field] = "";
      }
    }
    if (!source.translation.trim() && !source.romanization.trim()) continue;
    characters +=
      source.words.join("").length +
      (source.readings?.join("").length ?? 0) +
      source.translation.length +
      source.romanization.length;
    if (result.length >= 1000 || characters > 64_000) throw new Error("歌词过长，无法进行本地对齐");
    result.push(source);
  }
  return result;
};

/**
 * 校验文本和索引，省略的原词并入最近译文短语，语序冲突复用共享顺排流程
 * @param line - 不可修改的逐字主歌词
 * @param result - 本地算法返回的完整轨道
 * @param text - 本轨道必须保留的现成文本
 * @param field - 需要校验的辅助轨道类型
 * @returns 完整辅助索引片段；任何改写、越界或低分结果返回 null
 */
const validateAlignmentParts = (
  line: LyricLine,
  result: AlignmentTrackResult,
  text: string,
  field: "translation" | "romanization",
): AlignmentPart[] | null => {
  if (
    !text.trim() ||
    !Number.isFinite(result.score) ||
    result.score < 0.65 ||
    result.score > 1 ||
    !Array.isArray(result.parts) ||
    !result.parts.length ||
    result.parts.length > 256 ||
    result.parts.map((part) => part.text).join("") !== text
  )
    return null;
  const words: (LyricSpan & { from: number; to: number })[] = [];
  let previousTo = -1;
  for (const part of result.parts) {
    if (
      typeof part.text !== "string" ||
      !part.text.trim() ||
      !Number.isInteger(part.from) ||
      !Number.isInteger(part.to) ||
      part.from < 0 ||
      (field === "romanization" && part.from <= previousTo) ||
      part.to < part.from ||
      part.to >= line.words.length
    )
      return null;
    previousTo = part.to;
    const source = line.words.slice(part.from, part.to + 1).filter((word) => word.word.trim());
    if (!source.length) return null;
    const span = {
      word: part.text,
      from: part.from,
      to: part.to,
      startTime: Math.min(...source.map((word) => word.startTime)),
      endTime: Math.max(...source.map((word) => word.endTime)),
    };
    while (
      field === "romanization" &&
      words.length &&
      words[words.length - 1].endTime > span.startTime
    ) {
      const previous = words.pop()!;
      span.from = previous.from;
      span.word = previous.word + span.word;
      span.startTime = Math.min(previous.startTime, span.startTime);
      span.endTime = Math.max(previous.endTime, span.endTime);
    }
    words.push(span);
  }
  if (field === "translation" && words.length > 1) {
    const anchors = words.map((word) => ({ word, from: word.from, to: word.to }));
    for (const [index, source] of line.words.entries()) {
      if (
        !source.word.trim() ||
        anchors.some((anchor) => anchor.from <= index && anchor.to >= index)
      )
        continue;
      // 省略的助词等原词沿用最近语义短语，不能留下保存后再次被判为未完成的时间缺口
      const nearest = anchors.reduce((previous, current) =>
        Math.max(current.from - index, index - current.to, 0) <
        Math.max(previous.from - index, index - previous.to, 0)
          ? current
          : previous,
      ).word;
      nearest.from = Math.min(nearest.from, index);
      nearest.to = Math.max(nearest.to, index);
      nearest.startTime = Math.min(nearest.startTime, source.startTime);
      nearest.endTime = Math.max(nearest.endTime, source.endTime);
    }
  }
  return words.length > 1 &&
    new Set(words.map((word) => `${word.startTime}:${word.endTime}`)).size > 1
    ? words.map(({ word: text, from, to }) => ({ text, from, to }))
    : null;
};

/**
 * 原子应用选中的可靠行；主歌词、空白、声部及未处理辅助轨道原样保留
 * @param lines - 当前歌词
 * @param results - 用户预览后选中的可靠对齐行
 * @param realignExisting - 是否允许替换已有完整逐字对齐
 * @returns 新歌词；空结果、重复行或无效映射返回 null
 */
export const applyLocalAlignment = (
  lines: LyricLine[],
  results: AlignmentLineResult[],
  realignExisting = false,
): LyricLine[] | null => {
  if (!results.length || new Set(results.map((line) => line.id)).size !== results.length)
    return null;
  const planned = new Map(
    collectLocalAlignmentLines(lines, realignExisting).map((line) => [line.id, line]),
  );
  const next = lines.slice();
  for (const result of results) {
    const source = planned.get(result.id);
    if (!source || (!result.translation && !result.romanization)) return null;
    const line = lines[result.id];
    const update: GeneratedLyric = {};
    if (result.translation) {
      const parts = validateAlignmentParts(
        line,
        result.translation,
        source.translation,
        "translation",
      );
      if (!parts) return null;
      update.translation = parts;
    }
    if (result.romanization) {
      if (result.romanization.score < 0.8) return null;
      const parts = validateAlignmentParts(
        line,
        result.romanization,
        source.romanization,
        "romanization",
      );
      if (!parts) return null;
      update.romanization = parts.map(({ text, from: index, to }) => ({ text, index, to }));
    }
    next[result.id] = applyLyricResult(line, update, { translation: true, romanization: true });
  }
  return next;
};
