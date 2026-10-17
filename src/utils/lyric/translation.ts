import { toTTML } from "lyric-kit";
import type { LyricLine, LyricSpan } from "@shared/types/lyrics";
import { writeRomanizationRange } from "./romanization";

export const AUXILIARY_TIME_BASIS_KEY = "sakura-player:auxiliary-time-basis";

/**
 * 构建独立辅助轨道，保留声部、逐字时间和跨词音译范围
 * @param lines - 原歌词行，原文和逐字时间不会修改
 * @param translations - 已校验的行下标与辅助文本或逐字时间片段
 * @param language - 译文语言
 * @param timeBasis - 原始行边界或显示歌词规范化后的行边界
 * @returns 可随现有歌词存储数据保存的 TTML 辅助轨道
 */
export const createTranslationTrack = (
  lines: LyricLine[],
  translations: ReadonlyMap<number, string | LyricSpan[]>,
  language: string,
  timeBasis: "source" | "normalized" = "source",
): string => {
  const auxiliary: LyricLine[] = [];
  const agentIds = new Set(lines.map((line) => line.agentId));
  let anchorAgent = "ai-translation-anchor";
  while (agentIds.has(anchorAgent)) anchorAgent += "-";
  for (const [index, line] of lines.entries()) {
    if (line.isBG && auxiliary.length === 0) {
      auxiliary.push({
        ...line,
        words: [],
        isBG: false,
        isDuet: false,
        agentId: anchorAgent,
        translatedLyric: "",
        romanLyric: "",
      });
    }
    const text = translations.get(index);
    auxiliary.push({
      ...line,
      isDuet: false,
      agentId: line.agentId ?? (line.isDuet ? "v2" : undefined),
      words: Array.isArray(text)
        ? text
        : text
          ? [{ word: text, startTime: line.startTime, endTime: line.endTime }]
          : [],
      translatedLyric: "",
      romanLyric: "",
    });
  }
  const content = toTTML({
    lines: auxiliary,
    metadata: {
      language,
      timingMode: Array.from(translations.values()).some(Array.isArray) ? "Word" : "Line",
      rawProperties: { [AUXILIARY_TIME_BASIS_KEY]: [timeBasis] },
      agents: {
        [anchorAgent]: { id: anchorAgent, type: "group" },
        ...(!agentIds.has("v2") ? { v2: { id: "v2", type: "other" } } : {}),
      },
    },
  });
  if (!auxiliary.some((line) => line.words.some((word) => "from" in word))) return content;
  const doc = new DOMParser().parseFromString(content, "application/xml");
  const elements = Array.from(doc.getElementsByTagName("span")).filter(
    (element) => element.hasAttribute("begin") && !element.hasAttribute("ttm:role"),
  );
  const words = auxiliary.flatMap((line) => line.words);
  for (const [index, element] of elements.entries()) writeRomanizationRange(element, words[index]);
  return new XMLSerializer().serializeToString(doc);
};
