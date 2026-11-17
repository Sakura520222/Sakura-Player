import { describe, expect, it } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";
import { collectPrimaryAlignmentLines, applyPrimaryAlignment } from "./primaryAlignment";
import { applyLocalAlignment } from "./localAlignment";
import { serializeTtmlLyrics } from "@shared/utils/lyricTtmlExport";
import { parseExportTtml } from "@shared/utils/lyricTtml";

const line: LyricLine = {
  startTime: 1000,
  endTime: 5000,
  words: [{ word: "你好，世界！", startTime: 1000, endTime: 5000 }],
  translatedLyric: "Hello, world!",
  romanLyric: "ni hao shi jie",
  isBG: false,
  isDuet: false,
};
const primary = {
  score: 0.8,
  words: [
    { word: "你", startTime: 1100, endTime: 1300 },
    { word: "好，", startTime: 1600, endTime: 2200 },
    { word: "世", startTime: 3000, endTime: 3300 },
    { word: "界！", startTime: 3400, endTime: 4800 },
  ],
};

describe("声学主歌词候选", () => {
  it("重算主时间后仅保留辅助原文，旧均分或范围时间不再冒充完成", () => {
    const source = {
      ...line,
      estimatedTiming: true,
      words: [{ ...line.words[0], romanWord: line.romanLyric }],
      romanizationWords: [
        { word: line.romanLyric, startTime: 1000, endTime: 5000, from: 0, to: 0 },
      ],
      translationWords: [
        { word: line.translatedLyric, startTime: 1000, endTime: 5000, from: 0, to: 0 },
      ],
    };
    const before = structuredClone(source);
    const result = applyPrimaryAlignment(source, primary)!;
    expect(result.romanLyric).toBe(source.romanLyric);
    expect(result.translatedLyric).toBe(source.translatedLyric);
    expect(result.romanizationWords).toBeUndefined();
    expect(result.translationWords).toBeUndefined();
    expect(result.words.every((word) => !word.romanWord)).toBe(true);
    expect(source).toEqual(before);
    expect(applyPrimaryAlignment({ ...source, romanLyric: "" }, primary)?.romanLyric).toBe(
      source.romanLyric,
    );
  });
  it("字词和时间未变化时保留现有辅助关联及注音", () => {
    const source = {
      ...line,
      words: primary.words.map((word, index) => ({ ...word, romanWord: String(index) })),
      romanizationWords: [{ word: "0 1 2 3", startTime: 1100, endTime: 4800, from: 0, to: 3 }],
    };
    const result = applyPrimaryAlignment(source, primary)!;
    expect(result.words).toEqual(source.words);
    expect(result.romanizationWords).toEqual(source.romanizationWords);
  });
  it("整首主歌词都可重算，保留不属于主歌词的背景声部", () => {
    const timed = { ...line, words: primary.words };
    const candidates = collectPrimaryAlignmentLines([
      line,
      timed,
      { ...timed, estimatedTiming: true },
      { ...line, isBG: true },
    ]);
    expect(candidates.map((item) => item.id)).toEqual([0, 1, 2]);
  });

  it("低分候选仍可应用，但拒绝改字、倒序、重叠、越界和不完整候选", () => {
    expect(
      applyPrimaryAlignment(line, { ...primary, score: 0.01, warnings: ["需要试听检查"] }),
    ).not.toBeNull();
    for (const value of [
      { ...primary, score: -1 },
      { ...primary, words: primary.words.slice(1) },
      { ...primary, words: [...primary.words].reverse() },
      { ...primary, words: [{ ...primary.words[0], endTime: 1800 }, ...primary.words.slice(1)] },
      { ...primary, words: [{ ...primary.words[0], startTime: 400 }, ...primary.words.slice(1)] },
    ])
      expect(applyPrimaryAlignment(line, value)).toBeNull();
  });

  it("先应用主歌词，再以新字词索引关联辅助轨道，未选行不变", () => {
    const unchanged = { ...line, startTime: 6000, endTime: 10000 };
    const result = applyLocalAlignment(
      [line, unchanged],
      [
        {
          id: 0,
          primary,
          romanization: {
            score: 1,
            parts: [
              { text: "ni ", from: 0, to: 0 },
              { text: "hao ", from: 1, to: 1 },
              { text: "shi ", from: 2, to: 2 },
              { text: "jie", from: 3, to: 3 },
            ],
          },
        },
      ],
    )!;
    expect(result[0].words.map((word) => word.startTime)).toEqual([1100, 1600, 3000, 3400]);
    expect(result[0].translatedLyric).toBe(line.translatedLyric);
    expect(result[0].romanizationWords?.map((word) => word.startTime)).toEqual([
      1100, 1600, 3000, 3400,
    ]);
    expect(result[1]).toBe(unchanged);
    expect(line.words).toHaveLength(1);
  });

  it("TTML 交换后保留文本、停顿、时间与辅助歌词", () => {
    const aligned = applyPrimaryAlignment(line, primary)!;
    const exported = serializeTtmlLyrics(
      { id: "song", title: "测试", source: "local", artists: [], duration: 5000 },
      [aligned],
      { timingMode: "Word" },
    );
    const restored = parseExportTtml(exported.ttml).lines[0];
    expect(
      restored.words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime })),
    ).toEqual(primary.words);
    expect(restored.translatedLyric).toBe(line.translatedLyric);
    expect(restored.romanLyric).toBe(line.romanLyric);
  });
});
