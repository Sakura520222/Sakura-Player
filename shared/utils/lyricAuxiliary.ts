import type { LyricAuxiliaryData, LyricAuxiliaryLine, LyricLine } from "../types/lyrics";
import { resolveTimedWordRanges } from "./lyricWordRanges";

export const AUXILIARY_TRACKS = [
  ["translation", "translatedLyric", "translationWords", "translationLanguage"],
  ["romanization", "romanLyric", "romanizationWords", "romanizationLanguage"],
] as const;

/**
 * 固定单条辅助轨道的文本、时间和原词范围，供同一份主歌词重载
 * @param lines - 共享同一解析顺序的歌词行
 * @param track - 要记录的辅助轨道
 * @returns 与主歌词按行对应的独立数据
 */
export const captureAuxiliaryTrack = (
  lines: readonly LyricLine[],
  track: keyof LyricAuxiliaryData,
): LyricAuxiliaryLine[] => {
  const [, text, words, language] = AUXILIARY_TRACKS[track === "translation" ? 0 : 1];
  return lines.map((line) => ({
    text: line[text],
    ...(line[language] ? { language: line[language] } : {}),
    ...(line[words]?.length ? { words: line[words].map((word) => ({ ...word })) } : {}),
    wordCount: line.words.length,
  }));
};

/**
 * 恢复私有附件中的辅助轨道，仅按当前主歌词边界恢复可确认的音译关联
 * @param lines - 同一主歌词解析后的行
 * @param auxiliary - 已确认与主歌词属于同一版本的辅助数据
 */
export const restoreAuxiliaryTracks = (
  lines: LyricLine[],
  auxiliary: LyricAuxiliaryData | undefined,
): void => {
  for (const [key, text, words, language] of AUXILIARY_TRACKS) {
    const rows = auxiliary?.[key];
    if (!rows || rows.length !== lines.length) continue;
    for (const [index, row] of rows.entries()) {
      const line = lines[index];
      line[text] = row.text;
      line[language] = row.language;
      line[words] = row.wordCount === line.words.length ? row.words : undefined;
    }
  }
  const restoredRomanization = auxiliary?.romanization?.length === lines.length;
  for (const line of lines) {
    if (!restoredRomanization && !line.romanizationWords?.length) continue;
    line.words = line.words.map((word) => ({ ...word, romanWord: undefined }));
    const ranges = resolveTimedWordRanges(line.words, line.romanizationWords ?? []);
    if (ranges) line.romanizationWords = ranges;
    for (const part of ranges ?? []) {
      if (part.from !== undefined && line.words[part.from])
        line.words[part.from].romanWord = part.word.trim();
    }
  }
};
