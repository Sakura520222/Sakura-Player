import { describe, expect, it } from "vitest";
import { sequenceTranslationWords } from "@shared/utils/lyricTiming";

describe("译文按显示顺序高亮", () => {
  it("顺序正确的片段保留原对象和演唱间隔", () => {
    const words = [
      { word: "甲", startTime: 100, endTime: 300 },
      { word: "乙", startTime: 500, endTime: 900 },
    ];
    expect(sequenceTranslationWords(words)).toBe(words);
  });
  it("仅顺排语序冲突区间，保留前后准确的语义锚点与原始文本", () => {
    const words = [
      { word: "前", startTime: 0, endTime: 100 },
      { word: "甲乙", startTime: 500, endTime: 900 },
      { word: "丙丁戊", startTime: 100, endTime: 500 },
      { word: "后", startTime: 1000, endTime: 1200 },
    ];
    const before = structuredClone(words);
    const result = sequenceTranslationWords(words);
    expect(result).toEqual([
      words[0],
      { word: "甲乙", startTime: 100, endTime: 420 },
      { word: "丙丁戊", startTime: 420, endTime: 900 },
      words[3],
    ]);
    expect(result[0]).toBe(words[0]);
    expect(result[3]).toBe(words[3]);
    expect(words).toEqual(before);
    expect(sequenceTranslationWords(result)).toBe(result);
  });
  it("相同与部分重叠范围也须顺序播放，不同时点亮多个片段", () => {
    const result = sequenceTranslationWords([
      { word: "甲", startTime: 100, endTime: 900 },
      { word: "乙", startTime: 100, endTime: 500 },
      { word: "丙", startTime: 500, endTime: 900 },
    ]);
    expect(result.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
      [100, 367],
      [367, 633],
      [633, 900],
    ]);
  });
  it("组合表情与附加符号按字素计权，零时长片段不制造额外时间", () => {
    const result = sequenceTranslationWords([
      { word: "👨‍👩‍👧‍👦", startTime: 500, endTime: 900 },
      { word: "é", startTime: 100, endTime: 500 },
    ]);
    expect(result.map(({ startTime, endTime }) => [startTime, endTime])).toEqual([
      [100, 500],
      [500, 900],
    ]);
    const zero = [
      { word: "甲", startTime: 0, endTime: 0 },
      { word: "乙", startTime: 0, endTime: 0 },
    ];
    expect(sequenceTranslationWords(zero)).toBe(zero);
  });
  it("50 秒附近的冲突时间形态修复后只从左侧连续推进", () => {
    const input = [
      { word: "甲乙丙", startTime: 52510, endTime: 54770 },
      { word: "丁戊己", startTime: 50700, endTime: 52510 },
      { word: "庚辛", startTime: 54770, endTime: 55760 },
      { word: "壬癸", startTime: 55760, endTime: 58620 },
    ];
    const result = sequenceTranslationWords(input);
    for (let time = 50700; time <= 58620; time += 17) {
      const progress = result.map((word) =>
        time >= word.endTime
          ? 1
          : time <= word.startTime
            ? 0
            : (time - word.startTime) / (word.endTime - word.startTime),
      );
      for (let i = 1; i < progress.length; i++)
        if (progress[i] > 0) expect(progress[i - 1]).toBe(1);
    }
    expect(result[2]).toBe(input[2]);
    expect(result[3]).toBe(input[3]);
  });
});
