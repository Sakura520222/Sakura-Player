import { describe, expect, it } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";
import { hasCompleteAuxiliary } from "./auxiliaryCoverage";
import { getGenerationCoverage, createGenerationPlan } from "./aiGeneration";
import { collectLocalAlignmentLines } from "./localAlignment";
import { restoreAuxiliaryTracks } from "@shared/utils/lyricAuxiliary";

/** 模拟重算主歌词后仍残留旧均分音译的歌曲行 */
const staleLine = (): LyricLine => ({
  startTime: 1000,
  endTime: 5000,
  isBG: false,
  isDuet: false,
  words: [
    { word: "春", startTime: 1100, endTime: 1400 },
    { word: "の", startTime: 1700, endTime: 1800 },
    { word: "空", startTime: 2400, endTime: 4200 },
  ],
  translatedLyric: "春天的天空",
  romanLyric: "haru no sora",
  romanizationWords: [
    { word: "haru ", startTime: 1000, endTime: 2000 },
    { word: "no ", startTime: 2000, endTime: 3000 },
    { word: "sora", startTime: 3000, endTime: 5000 },
  ],
});

describe("辅助轨道完成度与当前主歌词一致", () => {
  it("旧音译拼起来覆盖整行，也不能冒充当前逐字关联", () => {
    const line = staleLine();
    expect(hasCompleteAuxiliary(line, line.romanizationWords, line.romanLyric)).toBe(false);
    expect(getGenerationCoverage([line]).existing.wordRomanization).toBe(0);
    expect(collectLocalAlignmentLines([line])[0].romanization).toBe(line.romanLyric);
    const plan = createGenerationPlan(
      [line],
      { translation: false, romanization: false, wordTranslation: false, wordRomanization: true },
      "missing",
    );
    expect(plan[0].options?.wordRomanization).toBe(true);
    expect(plan[0].existingRomanization).toBe(line.romanLyric);
  });
  it("旧索引存在但时间已失效时仍须重做", () => {
    const line = staleLine();
    line.romanizationWords!.forEach((part, index) =>
      Object.assign(part, { from: index, to: index }),
    );
    expect(hasCompleteAuxiliary(line, line.romanizationWords, line.romanLyric)).toBe(false);
  });
  it("没有语义范围的旧译文不能只凭覆盖整行就算逐字完成", () => {
    const line = staleLine();
    line.translationWords = line.romanizationWords;
    line.translatedLyric = line.romanLyric;
    expect(hasCompleteAuxiliary(line, line.translationWords, line.translatedLyric, true)).toBe(
      false,
    );
    expect(getGenerationCoverage([line]).existing.wordTranslation).toBe(0);
  });
  it("按真实字词边界倒装的译文仍算完整，不改变译文语序", () => {
    const line = staleLine();
    line.translatedLyric = "空の春";
    line.translationWords = [
      { word: "空", startTime: 2400, endTime: 4200 },
      { word: "の", startTime: 1700, endTime: 1800 },
      { word: "春", startTime: 1100, endTime: 1400 },
    ];
    const before = structuredClone(line);
    expect(hasCompleteAuxiliary(line, line.translationWords, line.translatedLyric, true)).toBe(
      true,
    );
    expect(line).toEqual(before);
  });
  it("无附件的精确时间可恢复字词关联，不改动文本与时间", () => {
    const line = staleLine();
    line.romanizationWords!.forEach((part, index) =>
      Object.assign(part, {
        startTime: line.words[index].startTime,
        endTime: line.words[index].endTime,
      }),
    );
    const before = structuredClone(line);
    expect(hasCompleteAuxiliary(line, line.romanizationWords, line.romanLyric)).toBe(true);
    expect(line).toEqual(before);
    restoreAuxiliaryTracks([line], undefined);
    expect(line.words.map((word) => word.romanWord)).toEqual(["haru", "no", "sora"]);
    expect(line.romanizationWords?.map((part) => [part.from, part.to])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(line.words.map(({ romanWord: _, ...word }) => word)).toEqual(before.words);
  });
  it("重载不能重新挂回旧时间的词内音译", () => {
    const line = staleLine();
    line.words.forEach((word) => {
      word.romanWord = "stale";
    });
    restoreAuxiliaryTracks([line], undefined);
    expect(line.words.every((word) => word.romanWord === undefined)).toBe(true);
    expect(line.romanLyric).toBe("haru no sora");
  });
});
