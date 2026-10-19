import { describe, expect, it } from "vitest";
import { normalizeLyricLines, parseLyric, toTTML } from "lyric-kit";
import type { LyricInput, LyricLine } from "@shared/types/lyrics";
import { LYRIC_SAVE_FIXTURES } from "@shared/testFixtures/lyricSave";
import { ALIGNMENT_LINES } from "@shared/testFixtures/lyricAlignment";
import { createGenerationPlan, getGenerationCoverage } from "@/services/lyric/aiGeneration";
import { collectLocalAlignmentLines } from "@/services/lyric/localAlignment";
import { applyGeneratedLyrics } from "./alignment";
import { applyTimedAuxiliary } from "./auxiliary";
import { getRomanizationSpans } from "./romanization";
import { createLyricSaveContent } from "./save";
import { createTranslationTrack } from "./translation";

const track = {
  id: "compatibility",
  source: "local" as const,
  title: "测试",
  artists: [],
  duration: 5000,
};

describe("算法对齐与 AI 辅助轨道兼容", () => {
  it.each(
    LYRIC_SAVE_FIXTURES.filter(({ format }) => ["qrc", "krc", "yrc", "lys"].includes(format)),
  )("$format 独立逐字音译和翻译转存 TTML 后保留原词映射", (fixture) => {
    let input: LyricInput = {
      content: fixture.content,
      format: fixture.format,
      translation: fixture.content
        .replaceAll("逐", "翻")
        .replaceAll("字", "译")
        .replaceAll("歌词", "内容"),
      translationFormat: fixture.format,
      romaji: fixture.content
        .replaceAll("逐", "zhu ")
        .replaceAll("字", "zi ")
        .replaceAll("歌词", "ge ci"),
      romajiFormat: fixture.format,
    };
    let expected: LyricLine[] | undefined;
    for (let repeat = 0; repeat < 3; repeat++) {
      const lines: LyricLine[] = parseLyric(input).lines;
      applyTimedAuxiliary(lines, input);
      normalizeLyricLines(lines);
      expect(getGenerationCoverage(lines).existing).toEqual({
        translation: 1,
        romanization: 1,
        wordTranslation: 1,
        wordRomanization: 1,
      });
      expect(collectLocalAlignmentLines(lines)).toEqual([]);
      if (expected) {
        expect(lines[0].translationWords).toEqual(expected[0].translationWords);
        expect(lines[0].romanizationWords).toEqual(expected[0].romanizationWords);
        expect(lines[0].words).toEqual(expected[0].words);
      }
      expected = structuredClone(lines);
      input = {
        ...input,
        translation: createTranslationTrack(
          lines,
          new Map([[0, lines[0].translationWords!]]),
          "zh-CN",
          "normalized",
        ),
        translationFormat: "ttml",
        romaji: createTranslationTrack(
          lines,
          new Map([[0, lines[0].romanizationWords!]]),
          "und-Latn",
          "normalized",
        ),
        romajiFormat: "ttml",
      };
    }
  });

  it.each(["っ", "み"])("QRC 空白读音只在对应促音时保留为空拍：%s", (middle) => {
    const input: LyricInput = {
      content: `[1000,600]き(1000,200)${middle}(1200,200)と(1400,200)`,
      format: "qrc",
      romaji: "[1000,600]ki (1000,200) (1200,200)to(1400,200)",
      romajiFormat: "qrc",
    };
    const lines: LyricLine[] = parseLyric(input).lines;
    const original = structuredClone(lines[0].words.map(({ romanWord: _roman, ...word }) => word));
    applyTimedAuxiliary(lines, input);
    expect(getGenerationCoverage(lines).existing.wordRomanization).toBe(middle === "っ" ? 1 : 0);
    expect(collectLocalAlignmentLines(lines).filter((line) => line.romanization)).toHaveLength(
      middle === "っ" ? 0 : 1,
    );
    expect(lines[0].words.map(({ romanWord: _roman, ...word }) => word)).toEqual(original);
    if (middle !== "っ") return;
    expect(lines[0].romanizationWords).toEqual([
      { word: "ki ", startTime: 1000, endTime: 1200 },
      { word: " to", startTime: 1200, endTime: 1600, from: 1, to: 2 },
    ]);
    const saved = {
      ...input,
      romaji: createTranslationTrack(
        lines,
        new Map([[0, lines[0].romanizationWords!]]),
        "und-Latn",
        "normalized",
      ),
      romajiFormat: "ttml" as const,
    };
    const reloaded: LyricLine[] = parseLyric(saved).lines;
    applyTimedAuxiliary(reloaded, saved);
    expect(reloaded[0].romanizationWords).toEqual(lines[0].romanizationWords);
    expect(getGenerationCoverage(reloaded).existing.wordRomanization).toBe(1);
  });

  it("词内音译恢复时保留完整空白，不把文本不一致的注音当作完整轨道", () => {
    const line = structuredClone(ALIGNMENT_LINES[0]);
    line.romanLyric = "  kimi  to aruku! ";
    line.words.forEach((word, index) => {
      word.romanWord = ["kimi", "to", "aruku!"][index];
    });
    expect(getRomanizationSpans(line)?.map((part) => part.word)).toEqual([
      "  kimi  ",
      "to ",
      "aruku! ",
    ]);
    expect(getGenerationCoverage([line]).existing.wordRomanization).toBe(1);
    line.words[1].romanWord = "wrong";
    expect(getRomanizationSpans(line)).toBeUndefined();
    expect(getGenerationCoverage([line]).existing.wordRomanization).toBe(0);
    expect(collectLocalAlignmentLines([line])[0].romanization).toBe(line.romanLyric);
  });

  it.each(["track", "ttml", "lrc", "lrc-crlf"] as const)(
    "%s 保存单个语义片段三次后，AI 与算法均识别为已对齐",
    (format) => {
      const source = structuredClone(ALIGNMENT_LINES[0]);
      source.translatedLyric = "与你同行";
      normalizeLyricLines([source]);
      const options = {
        translation: false,
        romanization: false,
        wordTranslation: true,
        wordRomanization: false,
      };
      let lines = applyGeneratedLyrics(
        [source],
        new Map([
          [
            0,
            {
              translation: [{ text: source.translatedLyric, from: 0, to: source.words.length - 1 }],
            },
          ],
        ]),
        options,
      )!;
      const expected = structuredClone(lines[0].translationWords);
      for (let repeat = 0; repeat < 3; repeat++) {
        const content = toTTML([source]);
        const auxiliary = {
          translation: createTranslationTrack(
            lines,
            new Map([[0, lines[0].translationWords!]]),
            "zh-CN",
            "normalized",
          ),
          translationFormat: "ttml" as const,
        };
        const saved = createLyricSaveContent(track, lines, content, auxiliary);
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
        expect(lines[0].translationWords).toEqual(expected);
        expect(getGenerationCoverage(lines).existing.wordTranslation).toBe(1);
        expect(createGenerationPlan(lines, options, "missing")).toEqual([]);
        expect(collectLocalAlignmentLines(lines)).toEqual([]);
      }
    },
  );

  it.each([false, true])("旧逐行片段在两个入口均判为待对齐，重复片段=%s", (duplicate) => {
    const line = structuredClone(ALIGNMENT_LINES[0]);
    line.translatedLyric = "与你同行";
    line.romanLyric = "kimi to aruku";
    line.translationWords = (duplicate ? ["与你", "同行"] : [line.translatedLyric]).map((word) => ({
      word,
      startTime: 1100,
      endTime: 4000,
    }));
    line.romanizationWords = (duplicate ? ["kimi to ", "aruku"] : [line.romanLyric]).map(
      (word) => ({ word, startTime: 1100, endTime: 4000 }),
    );
    expect(getGenerationCoverage([line]).existing).toEqual({
      translation: 1,
      romanization: 1,
      wordTranslation: 0,
      wordRomanization: 0,
    });
    expect(collectLocalAlignmentLines([line])[0]).toMatchObject({
      translation: line.translatedLyric,
      romanization: line.romanLyric,
    });
  });
});
