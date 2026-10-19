import { describe, expect, it } from "vitest";
import { parseLyric, toEnhancedLRC } from "lyric-kit";
import type { LyricInput, LyricLine } from "@shared/types/lyrics";
import { alignTranslation } from "@shared/testFixtures/legacyLyricAlignment";
import { applyTimedAuxiliary } from "@/utils/lyric/auxiliary";
import { createTranslationTrack } from "@/utils/lyric/translation";
import { applyLocalAlignment, collectLocalAlignmentLines } from "./localAlignment";
import { hasCompleteAuxiliary } from "./auxiliaryCoverage";
import fixtures from "./fixtures/localTranslationAlignment.json";
import fallbacks from "./fixtures/translationAlignmentFallbacks.json";

const accepted = [...fixtures, ...fallbacks.accepted];

/**
 * 为真实分词配对设置不等长的主歌词时间，检查译文是否沿用原词锚点
 * @param words - 音乐文件中的主歌词字词
 * @param translation - 必须完整保留的已有译文
 * @returns 带不等长词时间的主歌词
 */
const createLine = (words: string[], translation: string): LyricLine => {
  const timedWords = words.map((word, index) => ({
    word,
    startTime: 1000 + index * 300,
    endTime: 1000 + index * 300 + [80, 160, 240][index % 3],
  }));
  return {
    words: timedWords,
    startTime: timedWords[0].startTime,
    endTime: timedWords.at(-1)!.endTime,
    translatedLyric: translation,
    romanLyric: "已有音译",
    isBG: false,
    isDuet: false,
  };
};

describe("日文和英文歌曲的本地翻译对齐回归", () => {
  it.each(accepted)("$name：保留补词、省略和标点，沿用语义锚点", (fixture) => {
    const result = alignTranslation(fixture.source, fixture.target, fixture.pairs)!;
    expect(result).not.toBeNull();
    expect(result.parts).toEqual(fixture.expected);
    expect(result.parts.map((part) => part.text).join("")).toBe(fixture.target.join(""));
    expect(result.score).toBeGreaterThanOrEqual(0.65);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it.each(accepted)("$name：应用后保存重读保留译文和所有时间片段", (fixture) => {
    const line = createLine(fixture.words, fixture.target.join(""));
    const original = structuredClone(line);
    const translation = alignTranslation(fixture.source, fixture.target, fixture.pairs)!;
    const updated = applyLocalAlignment([line], [{ id: 0, translation }])!;
    expect(updated).not.toBeNull();
    expect(updated[0].words).toBe(line.words);
    expect(updated[0].romanLyric).toBe(line.romanLyric);
    expect(line).toEqual(original);
    expect(updated[0].translationWords).toEqual(
      fixture.expected.map((part, index) => ({
        word: part.text,
        startTime: fixture.times[index].startTime,
        endTime: fixture.times[index].endTime,
      })),
    );
    const input: LyricInput = {
      content: toEnhancedLRC([line], { roundTrip: true }),
      format: "lrc",
      translation: createTranslationTrack(
        updated,
        new Map([[0, updated[0].translationWords!]]),
        "zh-CN",
        "normalized",
      ),
      translationFormat: "ttml",
    };
    const reloaded: LyricLine[] = parseLyric(input).lines;
    applyTimedAuxiliary(reloaded, input);
    expect(reloaded[0].translatedLyric).toBe(line.translatedLyric);
    expect(reloaded[0].translationWords).toEqual(updated[0].translationWords);
    expect(
      hasCompleteAuxiliary(reloaded[0], reloaded[0].translationWords, line.translatedLyric),
    ).toBe(true);
    expect(
      collectLocalAlignmentLines(reloaded).filter((source) => source.translation.trim()),
    ).toEqual([]);
  });

  it.each(fallbacks.rejected)("$name：替代配对也没有足够的独立语义锚点", (fixture) => {
    for (const candidate of fixture.candidates)
      expect(alignTranslation(fixture.source, fixture.target, candidate)).toBeNull();
  });

  it("整句倒序覆盖省略的原词，时间限制在有效主歌词字词区间", () => {
    const line = createLine(["my ", "future ", "draw ", "tail"], "描绘我的未来");
    line.endTime = 9000;
    const source = line.words.map((word, index) => ({ text: word.word, from: index, to: index }));
    const translation = alignTranslation(
      source,
      ["描绘", "我的", "未来"],
      [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
    )!;
    const updated = applyLocalAlignment([line], [{ id: 0, translation }])!;
    expect(updated[0].translationWords).toEqual([
      { word: "描绘", startTime: 1000, endTime: 1327 },
      { word: "我的", startTime: 1327, endTime: 1653 },
      { word: "未来", startTime: 1653, endTime: 1980 },
    ]);
    expect(updated[0].words).toBe(line.words);
    line.romanLyric = "draw my future";
    expect(
      applyLocalAlignment(
        [line],
        [
          {
            id: 0,
            romanization: {
              score: 1,
              parts: [
                { text: "draw ", from: 2, to: 2 },
                { text: "my ", from: 0, to: 0 },
                { text: "future", from: 1, to: 1 },
              ],
            },
          },
        ],
      ),
    ).toBeNull();
  });

  it("省略的原词沿用最近短语，尾部静音不计入完整性覆盖", () => {
    const line = createLine(["you ", "changed ", "for ", "me"], "你改变");
    line.endTime = 9000;
    const translation = alignTranslation(
      line.words.map((word, index) => ({ text: word.word, from: index, to: index })),
      ["你", "改变"],
      [
        [0, 0],
        [1, 1],
      ],
    )!;
    const updated = applyLocalAlignment([line], [{ id: 0, translation }])!;
    expect(updated[0].translationWords).toEqual([
      { word: "你", startTime: 1000, endTime: 1080 },
      { word: "改变", startTime: 1300, endTime: 1980 },
    ]);
    expect(
      hasCompleteAuxiliary(updated[0], updated[0].translationWords, line.translatedLyric),
    ).toBe(true);
    expect(
      collectLocalAlignmentLines(updated).filter((source) => source.translation.trim()),
    ).toEqual([]);
  });

  it("覆盖不足的长段增译不能通过标点、空格或重复配对提高评分", () => {
    expect(
      alignTranslation(
        [
          { text: "hello", from: 0, to: 0 },
          { text: "world", from: 1, to: 1 },
          { text: ".", from: 2, to: 2 },
        ],
        ["你好", "这是一段完全无关的内容", "世界", " ".repeat(100), "！"],
        [
          [0, 0],
          [0, 0],
          [1, 2],
          [2, 1],
          [2, 3],
          [2, 4],
        ],
      ),
    ).toBeNull();
  });

  it("没有语义配对或实际只有同一个原词时间的结果仍保留逐行歌词", () => {
    const source = [
      { text: "my", from: 0, to: 0 },
      { text: "future", from: 1, to: 1 },
      { text: "draw", from: 2, to: 2 },
    ];
    expect(alignTranslation(source, ["描绘", "我的", "未来"], [])).toBeNull();
    expect(
      alignTranslation(
        source.map((token) => ({ ...token, from: 0, to: 0 })),
        ["描绘", "我的", "未来"],
        [
          [0, 1],
          [1, 2],
          [2, 0],
        ],
      ),
    ).toBeNull();
  });
});
