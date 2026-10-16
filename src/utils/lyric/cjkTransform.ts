/**
 * 歌词简繁中文转换（基于 OpenCC）
 */

import type { LyricLine } from "@shared/types/lyrics";
import type { CjkTransformMode } from "@shared/types/opencc";
import { transformLyricText } from "lyric-kit";

/**
 * 对歌词行数组应用 OpenCC 简繁转换
 * @param lines - 原始歌词行数组
 * @param mode - 转换模式
 * @returns 转换后的歌词行数组
 */
export const applyLyricCjkTransform = async (
  lines: LyricLine[],
  mode: CjkTransformMode,
): Promise<LyricLine[]> => {
  if (!lines || lines.length === 0 || !mode || mode === "none") {
    return lines;
  }

  if (typeof window === "undefined" || !window.api?.opencc?.convertBatch) {
    return lines;
  }

  try {
    const auxiliary = lines.flatMap((line) =>
      [line.translationWords, line.romanizationWords].flatMap((words) =>
        words?.length ? [{ ...line, words, translatedLyric: "", romanLyric: "" }] : [],
      ),
    );
    const transformed: LyricLine[] = await transformLyricText([...lines, ...auxiliary], (texts) =>
      window.api.opencc.convertBatch(texts, mode),
    );
    let next = lines.length;
    return transformed.slice(0, lines.length).map((line, index) => {
      if (lines[index].translationWords?.length) {
        line.translationWords = transformed[next++].words;
        line.translatedLyric = line.translationWords
          .map((word) => word.word)
          .join("")
          .trim();
      }
      if (lines[index].romanizationWords?.length) {
        line.romanizationWords = transformed[next++].words;
        line.romanLyric = line.romanizationWords
          .map((word) => word.word)
          .join("")
          .trim();
      }
      return line;
    });
  } catch (error) {
    console.error("[OpenCC] 歌词转换失败:", error);
    return lines;
  }
};
