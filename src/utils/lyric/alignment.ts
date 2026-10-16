import type { LyricLine } from "@shared/types/lyrics";
import type { AlignedTranslation } from "@/services/lyric/aiAlignment";
import { AlignmentDecoder, collectAlignmentLines } from "@/services/lyric/aiAlignment";

/**
 * 只复用主歌词字词时间，按语义范围生成辅助时间片段
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
  try {
    const decoder = new AlignmentDecoder(source);
    for (const [id, value] of results) decoder.push(JSON.stringify({ id, ...value }) + "\n");
    decoder.finish();
  } catch {
    return null;
  }
  return lines.map((line, id) => {
    const result = results.get(id);
    if (!result) return line;
    const romanization = new Map(result.romanization.map((word) => [word.index, word.text]));
    const translationWords = result.translation.map(({ text, from, to }) =>
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
    );
    const romanizationWords = line.words.flatMap((word, index) => {
      const text = romanization.get(index);
      return text
        ? [
            {
              word: text + (index < line.words.length - 1 ? " " : ""),
              startTime: word.startTime,
              endTime: word.endTime,
            },
          ]
        : [];
    });
    return {
      ...line,
      words: line.words.map((word, index) => ({
        ...word,
        romanWord: romanization.get(index),
      })),
      translatedLyric: translationWords.map((word) => word.word).join(""),
      romanLyric: romanizationWords
        .map((word) => word.word)
        .join("")
        .trim(),
      translationWords,
      romanizationWords,
    };
  });
};
