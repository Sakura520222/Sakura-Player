import { describe, expect, it } from "vitest";
import { pairTranslation, parseLyric, toTTML } from "lyric-kit";
import type { LyricLine } from "@shared/types/lyrics";
import { createTranslationTrack } from "./translation";

const line = (text: string, isBG = false, agentId?: string): LyricLine => ({
  startTime: 1234,
  endTime: 4321,
  words: text ? [{ word: text, startTime: 1234, endTime: 4321, romanWord: "original roman" }] : [],
  isBG,
  isDuet: agentId === "duet",
  agentId,
  translatedLyric: "old translation",
  romanLyric: "roman",
});

describe("AI 翻译辅助轨道", () => {
  it("同时刻的空行、对唱和背景声部逐一对应，保留原文、逐字与音译", () => {
    const input = [
      line("", false, "main"),
      line("A & B", false, "main"),
      line("Echo", true, "main"),
      line("Duet", false, "duet"),
    ];
    const original = structuredClone(input);
    const translations = new Map([
      [1, "甲 < 乙"],
      [2, "回声 & 合唱"],
      [3, "对唱"],
    ]);
    const content = toTTML(input.map((row) => ({ ...row, isDuet: false })));
    const auxiliary = createTranslationTrack(input, translations, "zh-CN");
    const result = parseLyric({
      content,
      format: "ttml",
      translation: auxiliary,
      translationFormat: "ttml",
    }).lines;
    expect(result.map((row) => row.translatedLyric)).toEqual([
      "old translation",
      "甲 < 乙",
      "回声 & 合唱",
      "对唱",
    ]);
    expect(input).toEqual(original);
    expect(parseLyric(auxiliary, { extractMetadata: true }).metadata.language).toBe("zh-CN");
  });

  it("首行即背景歌词时不丢失背景身份，未标记 agent 的声部也能重载", () => {
    const input = [line("Echo", true), line("Main"), line("Duet")];
    input[2].isDuet = true;
    const translation = createTranslationTrack(
      input,
      new Map([
        [0, "回声"],
        [1, "主唱"],
        [2, "对唱"],
      ]),
      "zh-CN",
    );
    // 用原始结构直接对齐，覆盖来自非 TTML 的背景与对唱标记。
    pairTranslation(input, parseLyric(translation).lines, "translatedLyric");
    expect(input.map((row) => row.translatedLyric)).toEqual(["回声", "主唱", "对唱"]);
  });

  it("从对唱侧开始的未标记声部仍按正确声部配对", () => {
    const input = [line("Duet"), line("Main")];
    input[0].isDuet = true;
    const translation = createTranslationTrack(
      input,
      new Map([
        [0, "对唱"],
        [1, "主唱"],
      ]),
      "zh-CN",
    );
    pairTranslation(input, parseLyric(translation).lines, "translatedLyric");
    expect(input.map((row) => row.translatedLyric)).toEqual(["对唱", "主唱"]);
  });
});
