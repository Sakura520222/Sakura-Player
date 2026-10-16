import { toTTML } from "lyric-kit";
import type { LyricLine } from "@shared/types/lyrics";

/**
 * 构建独立翻译轨道，保留同时间的不同声部，避免普通 LRC 合并对唱译文
 * @param lines - 原歌词行，原文和逐字时间不会修改
 * @param translations - 已校验的行下标与译文
 * @param language - 译文语言
 * @returns 可随现有歌词存储数据保存的 TTML 辅助轨道
 */
export const createTranslationTrack = (
  lines: LyricLine[],
  translations: ReadonlyMap<number, string>,
  language: string,
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
      words: text ? [{ word: text, startTime: line.startTime, endTime: line.endTime }] : [],
      translatedLyric: "",
      romanLyric: "",
    });
  }
  return toTTML({
    lines: auxiliary,
    metadata: {
      language,
      agents: {
        [anchorAgent]: { id: anchorAgent, type: "group" },
        ...(!agentIds.has("v2") ? { v2: { id: "v2", type: "other" } } : {}),
      },
    },
  });
};
