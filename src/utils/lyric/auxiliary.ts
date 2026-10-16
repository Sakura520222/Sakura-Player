import {
  alignRomanization,
  detectFormat,
  normalizeLyricLines,
  pairTranslation,
  parseLyric,
  parseTTMLTime,
} from "lyric-kit";
import type { LyricInput, LyricLine, LyricSpan } from "@shared/types/lyrics";
import { AUXILIARY_TIME_BASIS_KEY } from "./translation";

const metadataNamespace = "http://www.w3.org/ns/ttml#metadata";

/** 获取 TTML 语义角色，兼容显式前缀与命名空间属性 */
export const getTtmlRole = (element: Element): string | null =>
  element.getAttributeNS(metadataNamespace, "role") ?? element.getAttribute("ttm:role");

/** 按解析器的顺序返回主行及其直属背景声部，避免按时间排序导致同刻对唱错配 */
export const getTtmlLyricOwners = (doc: Document): Element[] => {
  const body = doc.getElementsByTagName("body")[0];
  const paragraphs = body
    ? Array.from(body.children).flatMap((element) =>
        element.localName === "div"
          ? Array.from(element.getElementsByTagName("p"))
          : element.localName === "p"
            ? [element]
            : [],
      )
    : [];
  return paragraphs.flatMap((paragraph) => [
    paragraph,
    ...Array.from(paragraph.children).filter((element) => getTtmlRole(element) === "x-bg"),
  ]);
};

/**
 * 使用现有声部与时间匹配规则定位完整辅助行，匹配标记仅存在于临时副本
 * @param lines - 当前显示歌词，可能已剥离元信息行
 * @param auxiliary - 带辅助时间片段的歌词
 * @param field - 独立辅助轨道的目标字段，内嵌轨道不替换已选语言的文本
 * @param normalized - 生成轨道按规范化后的主歌词边界配对
 */
const pairTimedLines = (
  lines: LyricLine[],
  auxiliary: LyricLine[],
  field?: "translationWords" | "romanizationWords",
  normalized = false,
): void => {
  const probes = lines.map((line) => ({
    ...line,
    words: line.words.map((word) => ({ ...word })),
    translatedLyric: "",
  }));
  if (normalized) normalizeLyricLines(probes);
  const tagged = auxiliary.map((line, index) => ({
    ...line,
    words: [{ word: `sakuraAux${index}`, startTime: line.startTime, endTime: line.endTime }],
  }));
  pairTranslation(probes, tagged, "translatedLyric");
  for (const [index, probe] of probes.entries()) {
    const match = /^sakuraAux(\d+)$/.exec(probe.translatedLyric);
    if (!match) continue;
    const source = auxiliary[Number(match[1])];
    const line = lines[index];
    if (field) {
      if (normalized) {
        const text = source.words
          .map((word) => word.word)
          .join("")
          .trim();
        if (field === "translationWords") line.translatedLyric = text;
        else line.romanLyric = text;
      }
      line[field] = undefined;
    }
    if (
      source.translationWords?.length &&
      source.translationWords
        .map((word) => word.word)
        .join("")
        .replace(/\s+/g, " ")
        .trim() === line.translatedLyric.replace(/\s+/g, " ").trim()
    )
      line.translationWords = source.translationWords;
    if (
      source.romanizationWords?.length &&
      source.romanizationWords
        .map((word) => word.word)
        .join("")
        .replace(/\s+/g, " ")
        .trim() === line.romanLyric.replace(/\s+/g, " ").trim()
    ) {
      line.romanizationWords = source.romanizationWords;
      const words = line.words.filter((word) => word.word.trim());
      const romanization = source.romanizationWords;
      // AI 音译已按原词生成，重叠或零时长不能再次按时间交集贪心合并。
      if (
        words.length === romanization.length &&
        words.every(
          (word, index) =>
            word.startTime === romanization[index].startTime &&
            word.endTime === romanization[index].endTime,
        )
      )
        words.forEach((word, index) => {
          word.romanWord = romanization[index].word.trim();
        });
      else alignRomanization(line.words, romanization);
    }
  }
};

/**
 * 从标准 TTML 内嵌与独立辅助轨道恢复逐字时间，不改变主歌词字词
 * @param lines - 已解析的当前歌词，原始边界用于匹配普通外部轨道
 * @param input - 原始歌词及可选辅助轨道
 * @param preferredLang - 与主歌词解析一致的首选翻译语言
 */
export const applyTimedAuxiliary = (
  lines: LyricLine[],
  input: LyricInput,
  preferredLang = "",
): void => {
  // 普通行级译文无需再次解析主文件，只有内嵌逐字副轨才读取其时间片段。
  if (
    input.format === "ttml" &&
    /\b(?:[\w.-]+:)?role\s*=\s*["']x-(?:translation|roman)["'][^>]*>\s*<(?:[\w.-]+:)?span\b[^>]*\bbegin\s*=/.test(
      input.content,
    )
  ) {
    const parsed: LyricLine[] = parseLyric(
      { content: input.content, format: "ttml" },
      { preferredLang },
    ).lines;
    const doc = new DOMParser().parseFromString(input.content, "application/xml");
    const owners = getTtmlLyricOwners(doc);
    if (owners.length !== parsed.length) throw new Error("TTML 辅助轨道无法对应主歌词");
    for (const [index, owner] of owners.entries()) {
      for (const role of ["x-translation", "x-roman"] as const) {
        const text =
          role === "x-translation" ? parsed[index].translatedLyric : parsed[index].romanLyric;
        const node = Array.from(owner.children).find(
          (element) =>
            getTtmlRole(element) === role &&
            element.textContent?.replace(/\s+/g, " ").trim() === text,
        );
        if (!node) continue;
        const words: LyricSpan[] = Array.from(node.children).flatMap((element) => {
          const begin = element.getAttribute("begin");
          const end = element.getAttribute("end");
          if (!begin || !end || !element.textContent?.trim()) return [];
          const startTime = parseTTMLTime(begin),
            endTime = parseTTMLTime(end);
          return Number.isFinite(startTime) &&
            Number.isFinite(endTime) &&
            startTime >= 0 &&
            endTime >= startTime
            ? [{ word: element.textContent, startTime, endTime }]
            : [];
        });
        if (!words.length) continue;
        if (role === "x-translation") parsed[index].translationWords = words;
        else parsed[index].romanizationWords = words;
      }
    }
    pairTimedLines(lines, parsed);
  }
  for (const [content, format, field] of [
    [input.translation, input.translationFormat, "translationWords"],
    [input.romaji, input.romajiFormat, "romanizationWords"],
  ] as const) {
    if (!content) continue;
    const actualFormat = format ?? detectFormat(content);
    if (actualFormat !== "ttml" && actualFormat !== "lrc") continue;
    const result = parseLyric({ content, format: actualFormat }, { extractMetadata: true });
    const timeBasis = result.metadata.rawProperties?.[AUXILIARY_TIME_BASIS_KEY]?.[0];
    // 旧版生成轨道仅带专用占位声部，仍须沿用其规范化时间基准与逐字数据。
    const legacyGenerated =
      !timeBasis &&
      Object.values(result.metadata.agents ?? {}).some(
        (agent) => /^ai-translation-anchor-*$/.test(agent.id) && agent.type === "group",
      );
    const normalized = timeBasis === "normalized" || legacyGenerated;
    if (normalized) {
      for (const line of lines) {
        if (field === "translationWords") line.translatedLyric = "";
        else {
          line.romanLyric = "";
          for (const word of line.words) delete word.romanWord;
        }
        line[field] = undefined;
      }
    }
    const auxiliary: LyricLine[] = result.lines.map((line) => ({
      ...line,
      // 普通 LRC 只有行起点，其推导的行尾不能当作真实逐字对齐数据。
      [field]:
        (actualFormat === "ttml" && (result.metadata.timingMode === "Word" || legacyGenerated)) ||
        (actualFormat === "lrc" && line.words.length > 1)
          ? line.words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime }))
          : undefined,
    }));
    pairTimedLines(lines, auxiliary, field, normalized);
  }
};
