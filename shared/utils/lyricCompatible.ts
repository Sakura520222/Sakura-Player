import { formatTtmlTime, parseLRC, parseLyric } from "lyric-kit";
import type { CompatibleLyricFormat, LyricLine, LyricMetadata } from "../types/lyrics";

const lrcTime = "\\d{2,3}:[0-5]\\d\\.\\d{2,3}";
const lrcRow = new RegExp(`^\\[(${lrcTime})\\](.*)$`);
const a2Word = new RegExp(`<${lrcTime}>`, "g");
const tags = /^(?:\[(?:ti|ar|al|by|au|length|re|ve):[^\r\n]*\]|\[offset:[+-]?\d+\])$/;

/**
 * 校验本程序导出的兼容歌词语法，再交给对应的播放解析器
 * @param content - 单条原文、翻译或音译文件的内容
 * @param format - 实际使用的目标格式
 * @returns 可用于比较内容与时间的歌词行
 */
export const parseCompatibleExport = (content: string, format: CompatibleLyricFormat) => {
  const rows = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((row) => row.trim());
  const lyricRows = rows.filter((row) => !tags.test(row));
  if (!lyricRows.length) throw new Error("歌词文件没有可用的内容");
  if (format === "lrc" || format === "enhanced-lrc") {
    const parsed = lyricRows.flatMap((row) => {
      const match = lrcRow.exec(row);
      if (
        !match ||
        // eslint-disable-next-line no-control-regex -- 歌词正文不允许破坏文本解析的控制字符
        /[\u0000-\u0008\u000b-\u001f]/.test(row) ||
        /\[\d+:\d+(?:[.:]\d+)?\]/.test(match[2]) ||
        (format === "lrc" && /<\d+:\d+(?:[.:]\d+)?>/.test(match[2]))
      )
        throw new Error("LRC 文件含有无效时间戳、行或格式扩展");
      if (!match[2].trim()) return [];
      const line = parseLRC(row, { detectBackground: false }).lines[0];
      const count = [...match[2].matchAll(a2Word)].length;
      if (!line || (format === "enhanced-lrc" && count !== line.words.length))
        throw new Error("Enhanced LRC 没有可识别的逐字时间");
      return [line];
    });
    if (!parsed.length) throw new Error("LRC 文件没有可用的歌词");
    return parsed;
  }
  const header = format === "lys" ? /^\[[3-8]\]/ : /^\[\d+,\d+\]/;
  const word = format === "yrc" ? /\(\d+,\d+,0\)/g : /\(\d+,\d+\)/g;
  const lines = parseLyric(lyricRows.join("\n"), { format, detectBackground: false }).lines;
  if (
    lines.length !== lyricRows.length ||
    lyricRows.some(
      (row, index) =>
        !header.test(row) ||
        [...row.matchAll(word)].length !== lines[index].words.length ||
        [lines[index], ...lines[index].words].some(
          ({ startTime, endTime }) =>
            !Number.isSafeInteger(startTime) ||
            !Number.isSafeInteger(endTime) ||
            endTime < startTime,
        ),
    )
  )
    throw new Error(`${format.toUpperCase()} 文件含有无效的行或逐字时间`);
  return lines;
};

/**
 * 用通用 LRC 标签记录标题、艺人等信息，移除会破坏单行语法的字符
 * @param metadata - 歌曲和歌词的元数据
 * @returns LRC 文件头
 */
const lrcHeader = (metadata: LyricMetadata): string[] =>
  (
    [
      ["ti", metadata.title],
      ["ar", metadata.artist],
      ["al", metadata.album],
      ["by", metadata.authors],
    ] as const
  )
    .filter(([, values]) => values?.length)
    .map(
      ([key, values]) =>
        `[${key}:${values!
          .join(", ")
          .replace(/[\r\n[\]]/g, " ")
          .trim()}]`,
    );

/**
 * 生成单轨兼容歌词并用真实目标解析器核对目标格式可表达的文本和时间
 * @param lines - 当前完整歌词
 * @param format - 用户选择的目标格式
 * @param metadata - 可写入 LRC 标准标签的元数据
 * @returns 主歌词和使用同一行时间轴的可选 LRC 副文件
 */
export const serializeCompatibleLyrics = (
  lines: readonly LyricLine[],
  format: CompatibleLyricFormat,
  metadata: LyricMetadata = {},
): { lrc: string; translation?: string; romanization?: string } => {
  const rows = lines.flatMap((line) => {
    const text = line.words
      .map((word) => word.word)
      .join("")
      .replace(/\s*\r?\n\s*/g, " ")
      .trim();
    if (!text) return [];
    const startTime =
      format === "enhanced-lrc" || format === "lys" ? line.words[0].startTime : line.startTime;
    if (
      ![
        line.startTime,
        line.endTime,
        ...line.words.flatMap((word) => [word.startTime, word.endTime]),
      ].every((time) => Number.isSafeInteger(time) && time >= 0) ||
      line.words.some((word) => word.endTime < word.startTime)
    )
      throw new Error("歌词时间无效");
    return [{ line, text, startTime }];
  });

  /**
   * 输出一条 LRC 文本轨道，同时刻的演唱行合在一个时间点，防止被播放器作成翻译
   * @param field - 从当前行选择要导出的歌词文本
   * @returns 含标准 LRC 标签的歌词，空轨道不生成文件
   */
  const writeTextTrack = (field: (row: (typeof rows)[number]) => string) => {
    const byTime = new Map<number, string[]>();
    let endTime = 0;
    for (const row of rows) {
      const value = field(row)
        .replace(/\s*\r?\n\s*/g, " ")
        .trim();
      if (!value) continue;
      endTime = Math.max(endTime, row.line.endTime);
      const texts = byTime.get(row.startTime) ?? [];
      texts.push(value);
      byTime.set(row.startTime, texts);
    }
    const expected = Array.from(byTime, ([startTime, values]) => ({
      startTime,
      text: values.join(" / "),
    })).sort((a, b) => a.startTime - b.startTime);
    if (!expected.length) return undefined;
    const content = [
      ...lrcHeader(metadata),
      ...expected.map(({ startTime, text }) => `[${formatTtmlTime(startTime)}]${text}`),
      // 部分播放器用下一条时间戳推算当前行时长，避免最后一句因为缺少下一行而消失
      ...(endTime > expected.at(-1)!.startTime ? [`[${formatTtmlTime(endTime)}]`] : []),
    ].join("\n");
    if (
      parseCompatibleExport(content, "lrc").some(
        (line, index) =>
          line.startTime !== expected[index].startTime ||
          line.words.map((word) => word.word).join("") !== expected[index].text,
      )
    )
      throw new Error("LRC 无法保留原始歌词文本或行时间");
    return content;
  };

  let lrc = format === "lrc" ? writeTextTrack((row) => row.text) : undefined;
  if (format !== "lrc") {
    const enhanced = format === "enhanced-lrc";
    const enhancedTimes = new Set<number>();
    const body = rows.map(({ line, startTime }) => {
      const chunk = line.words
        .map((word) => {
          const timing = `${word.startTime},${word.endTime - word.startTime}`;
          if (enhanced) return `<${formatTtmlTime(word.startTime)}>${word.word}`;
          if (format === "yrc") return `(${timing},0)${word.word}`;
          return `${word.word}(${timing})`;
        })
        .join("");
      if (enhanced) {
        if (
          enhancedTimes.has(startTime) ||
          line.words.some(
            (word, index) => index > 0 && word.startTime <= line.words[index - 1].startTime,
          )
        )
          throw new Error("Enhanced LRC 无法表达同刻或倒序的逐字歌词，请使用 TTML");
        enhancedTimes.add(startTime);
        return `[${formatTtmlTime(startTime)}]${chunk}`;
      }
      if (format === "lys")
        return `[${line.isBG ? (line.isDuet ? 8 : 6) : line.isDuet ? 5 : 4}]${chunk}`;
      return `[${startTime},${Math.max(line.endTime, ...line.words.map((word) => word.endTime)) - startTime}]${chunk}`;
    });
    const endTime = Math.max(...rows.map(({ line }) => line.endTime));
    if (enhanced && endTime > Math.max(...rows.map(({ startTime }) => startTime)))
      body.push(`[${formatTtmlTime(endTime)}]`);
    lrc = [...(enhanced ? lrcHeader(metadata) : []), ...body].join("\n");
    if (
      parseCompatibleExport(lrc, format).some((parsed, index) => {
        const { line, text, startTime } = rows[index];
        return (
          parsed.startTime !== startTime ||
          parsed.words.length !== line.words.length ||
          parsed.words
            .map((word) => word.word)
            .join("")
            .trim() !== text ||
          parsed.words.some(
            (word, wordIndex) =>
              word.startTime !== line.words[wordIndex].startTime ||
              (!enhanced && word.endTime !== line.words[wordIndex].endTime),
          )
        );
      })
    )
      throw new Error(`${format.toUpperCase()} 无法保留原始逐字歌词，请使用 TTML`);
  }
  if (!lrc) throw new Error("没有可保存的歌词");
  return {
    lrc,
    translation: writeTextTrack(
      ({ line }) =>
        line.translatedLyric || line.translationWords?.map((word) => word.word).join("") || "",
    ),
    romanization: writeTextTrack(
      ({ line }) =>
        line.romanLyric ||
        line.romanizationWords?.map((word) => word.word).join("") ||
        line.words.map((word) => word.romanWord ?? "").join(" "),
    ),
  };
};
