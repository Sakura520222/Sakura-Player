import { describe, expect, it } from "vitest";
import { normalizeLyricLines, parseLyric, toTTML } from "lyric-kit";
import type { LyricInput, LyricLine } from "@shared/types/lyrics";
import {
  ROMANIZATION_RANGE_LINE,
  ROMANIZATION_RANGE_OPTIONS,
  ROMANIZATION_RANGE_RESULT,
} from "@shared/testFixtures/lyricRomanization";
import { applyGeneratedLyrics } from "./alignment";
import { applyTimedAuxiliary } from "./auxiliary";
import { createLyricSaveContent } from "./save";
import { createTranslationTrack } from "./translation";
import { alignRomanizationWords } from "./romanization";

describe("范围音译保存与恢复", () => {
  it.each(["track", "ttml", "lrc", "lrc-crlf"] as const)(
    "%s 连续保存重读三次保留跨词范围、主词时间及已有音译空格",
    (format) => {
      const source = structuredClone(ROMANIZATION_RANGE_LINE);
      const original = structuredClone(source);
      const generated = applyGeneratedLyrics(
        [source],
        new Map([[0, ROMANIZATION_RANGE_RESULT]]),
        ROMANIZATION_RANGE_OPTIONS,
      )!;
      const expected = structuredClone(generated[0].romanizationWords);
      expect(
        expected?.filter((part) => part.from !== undefined).map(({ from, to }) => [from, to]),
      ).toEqual([
        [0, 1],
        [4, 5],
        [8, 9],
      ]);
      let lines = generated;
      for (let repeat = 0; repeat < 3; repeat++) {
        const content = toTTML([source]);
        const auxiliary = {
          romaji: createTranslationTrack(
            lines,
            new Map([[0, lines[0].romanizationWords!]]),
            "und-Latn",
            "normalized",
          ),
          romajiFormat: "ttml" as const,
        };
        const saved = createLyricSaveContent(
          { id: "range", source: "local", title: "范围音译", artists: [], duration: 3200 },
          lines,
          content,
          auxiliary,
        );
        const input: LyricInput =
          format === "track"
            ? { content, format: "ttml", ...auxiliary }
            : {
                content:
                  format === "ttml"
                    ? saved.ttml!
                    : format === "lrc-crlf"
                      ? saved.lrc.replace(/\n/g, "\r\n")
                      : saved.lrc,
                format: format === "lrc-crlf" ? "lrc" : format,
              };
        lines = parseLyric(input).lines;
        applyTimedAuxiliary(lines, input);
        normalizeLyricLines(lines);
        expect(lines[0].romanizationWords).toEqual(expected);
        expect(lines[0].romanLyric).toBe(source.romanLyric);
        expect(
          lines[0].words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime })),
        ).toEqual(source.words);
      }
      expect(source).toEqual(original);
    },
  );

  it("旧版没有下标的多片段轨道按唯一的时间分组恢复范围", () => {
    const generated = applyGeneratedLyrics(
      [structuredClone(ROMANIZATION_RANGE_LINE)],
      new Map([[0, ROMANIZATION_RANGE_RESULT]]),
      ROMANIZATION_RANGE_OPTIONS,
    )!;
    const parts = generated[0].romanizationWords!.map(({ from: _from, to: _to, ...part }) => part);
    const words = structuredClone(ROMANIZATION_RANGE_LINE.words);
    expect(alignRomanizationWords(words, parts)).toEqual(generated[0].romanizationWords);
    expect(words).toEqual(generated[0].words);
  });

  it.each([0, 200])("同刻且时长为 %s 的原词依靠显式范围无损重载", (duration) => {
    const source = structuredClone(ROMANIZATION_RANGE_LINE);
    source.endTime = 1000 + duration;
    source.words.forEach((word) => {
      word.startTime = 1000;
      word.endTime = source.endTime;
    });
    const generated = applyGeneratedLyrics(
      [source],
      new Map([[0, ROMANIZATION_RANGE_RESULT]]),
      ROMANIZATION_RANGE_OPTIONS,
    )!;
    const input: LyricInput = {
      content: toTTML([source]),
      format: "ttml",
      romaji: createTranslationTrack(
        generated,
        new Map([[0, generated[0].romanizationWords!]]),
        "und-Latn",
      ),
      romajiFormat: "ttml",
    };
    const lines: LyricLine[] = parseLyric(input).lines;
    expect(input.romaji).toContain('sakura:from="0" sakura:to="1"');
    applyTimedAuxiliary(lines, input);
    expect(lines[0].romanizationWords).toEqual(generated[0].romanizationWords);
    expect(lines[0].words).toEqual(generated[0].words);
  });

  it("旧逐行音译不被当成范围音译，破损 LRC 扩展仍可读取普通歌词", () => {
    const source = structuredClone(ROMANIZATION_RANGE_LINE);
    const parts = [
      { word: source.romanLyric, startTime: source.startTime, endTime: source.endTime },
    ];
    expect(alignRomanizationWords(source.words, parts)).toEqual(parts);
    expect(source.words.every((word) => !word.romanWord)).toBe(true);
    const input: LyricInput = {
      content: "[sakura-romanization:%zz]\n[00:01]普通歌词",
      format: "lrc",
    };
    const lines: LyricLine[] = parseLyric(input).lines;
    applyTimedAuxiliary(lines, input);
    expect(lines[0].words.map((word) => word.word).join("")).toBe("普通歌词");
  });
});
