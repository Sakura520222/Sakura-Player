import { describe, expect, it } from "vitest";
import { normalizeLyricLines, parseLyric, toTTML } from "lyric-kit";
import type { LyricLine } from "@shared/types/lyrics";
import { ALIGNMENT_LINES, ALIGNMENT_RESULT } from "@shared/testFixtures/lyricAlignment";
import { alignGeneratedLyrics } from "./alignment";
import { AUXILIARY_TIME_BASIS_KEY, createTranslationTrack } from "./translation";
import { applyTimedAuxiliary } from "./auxiliary";
import { createLyricSaveContent } from "./save";

describe("逐字辅助歌词对齐与重载", () => {
  it("内嵌逐字译文跟随主歌词所选语言", () => {
    const input = {
      content: `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s" end="3s"><span begin="1s" end="3s">君</span><span ttm:role="x-translation" xml:lang="zh-CN"><span begin="1s" end="3s">你</span></span><span ttm:role="x-translation" xml:lang="en"><span begin="1s" end="3s">you</span></span></p></div></body></tt>`,
      format: "ttml" as const,
    };
    const lines: LyricLine[] = parseLyric(input, { preferredLang: "en" }).lines;
    applyTimedAuxiliary(lines, input, "en");
    expect(lines[0].translatedLyric).toBe("you");
    expect(lines[0].translationWords).toEqual([{ word: "you", startTime: 1000, endTime: 3000 }]);
  });

  it("规范化时间恰好命中另一行原始起点时，不串行或串声部", () => {
    const input = {
      content: `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s" end="5s"><span begin="3s" end="4s">A</span></p><p begin="3s" end="8s"><span begin="6s" end="7s">B</span><span ttm:role="x-bg" begin="6s" end="8s"><span begin="6s" end="8s">C</span></span></p></div></body></tt>`,
      format: "ttml" as const,
    };
    const source: LyricLine[] = parseLyric(input).lines;
    normalizeLyricLines(source);
    const results = new Map(
      source.map((line, index) => [
        index,
        {
          translation: [{ text: `译文${index}`, from: 0, to: 0 }],
          romanization: [{ index: 0, text: line.words[0].word }],
        },
      ]),
    );
    const generated = alignGeneratedLyrics(source, results)!;
    const translation = createTranslationTrack(
      generated,
      new Map(generated.map((line, index) => [index, line.translationWords!])),
      "zh-CN",
      "normalized",
    );
    const loaded: LyricLine[] = parseLyric({
      ...input,
      translation,
      translationFormat: "ttml",
    }).lines;
    applyTimedAuxiliary(loaded, { ...input, translation, translationFormat: "ttml" });
    normalizeLyricLines(loaded);
    expect(loaded.map((line) => line.translatedLyric)).toEqual(["译文0", "译文1", "译文2"]);
    expect(loaded.map((line) => line.translationWords)).toEqual(
      generated.map((line) => line.translationWords),
    );
  });

  it("兼容未标记时间基准的旧 AI 辅助轨道，单片段数据也能保留", () => {
    const content = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="5s"><span begin="3s" end="4s">君</span></p></div></body></tt>`;
    const source: LyricLine[] = parseLyric(content).lines;
    normalizeLyricLines(source);
    const input = {
      content,
      format: "ttml" as const,
      translation: createTranslationTrack(
        source,
        new Map([[0, [{ word: "你", startTime: 3000, endTime: 4000 }]]]),
        "zh-CN",
        "normalized",
      ),
      translationFormat: "ttml" as const,
    };
    const doc = new DOMParser().parseFromString(input.translation, "application/xml");
    for (const node of Array.from(doc.getElementsByTagName("amll:meta")))
      if (node.getAttribute("key") === AUXILIARY_TIME_BASIS_KEY) node.remove();
    doc.documentElement.setAttributeNS(
      "http://music.apple.com/lyric-ttml-internal",
      "itunes:timing",
      "Line",
    );
    input.translation = new XMLSerializer().serializeToString(doc);
    const loaded: LyricLine[] = parseLyric(input).lines;
    applyTimedAuxiliary(loaded, input);
    expect(loaded[0].translatedLyric).toBe("你");
    expect(loaded[0].translationWords).toEqual([{ word: "你", startTime: 3000, endTime: 4000 }]);
  });

  it("普通逐行翻译保留原有显示方式，不将推导行尾误当作逐字对齐", () => {
    const input = {
      content: "[00:01]Main lyric",
      format: "lrc" as const,
      translation: "[00:01]普通译文",
    };
    const lines: LyricLine[] = parseLyric(input).lines;
    applyTimedAuxiliary(lines, input);
    expect(lines[0].translatedLyric).toBe("普通译文");
    expect(lines[0].translationWords).toBeUndefined();
  });
  const aligned = () =>
    alignGeneratedLyrics(structuredClone(ALIGNMENT_LINES), new Map([[0, ALIGNMENT_RESULT]]))!;

  it("行起点早于首字超过配对容差时，重载与导出仍保留辅助轨道", () => {
    const original = structuredClone(ALIGNMENT_LINES);
    original[0].words = original[0].words.map((word) => ({
      ...word,
      startTime: word.startTime + 2000,
      endTime: word.endTime + 2000,
      ruby: undefined,
    }));
    original[0].endTime += 2000;
    const content = toTTML(original);
    const source: LyricLine[] = parseLyric(content).lines;
    normalizeLyricLines(source);
    const generated = alignGeneratedLyrics(source, new Map([[0, ALIGNMENT_RESULT]]))!;
    const input = {
      content,
      format: "ttml" as const,
      translation: createTranslationTrack(
        generated,
        new Map([[0, generated[0].translationWords!]]),
        "en",
        "normalized",
      ),
      translationFormat: "ttml" as const,
      romaji: createTranslationTrack(
        generated,
        new Map([[0, generated[0].romanizationWords!]]),
        "und-Latn",
        "normalized",
      ),
      romajiFormat: "ttml" as const,
    };
    const loaded: LyricLine[] = parseLyric(input).lines;
    normalizeLyricLines(loaded);
    applyTimedAuxiliary(loaded, input);
    expect(loaded[0].translatedLyric).toBe(generated[0].translatedLyric);
    expect(loaded[0].translationWords).toEqual(generated[0].translationWords);
    const saved = createLyricSaveContent(
      { id: "gap", title: "时间差", source: "local", artists: [], duration: 7000 },
      generated,
      content,
      input,
    );
    expect(parseLyric(saved.ttml!).lines[0].translatedLyric).toBe(generated[0].translatedLyric);
  });

  it.each(["overlap", "zero-duration", "same-time"])(
    "%s 的主字词重载后保留一对一音译",
    (timing) => {
      const source = structuredClone(ALIGNMENT_LINES);
      source[0].words = source[0].words.map((word) => ({
        ...word,
        ...(timing === "same-time"
          ? { startTime: 1100, endTime: 4000 }
          : timing === "overlap"
            ? { endTime: 4000 }
            : { endTime: word.startTime }),
        ruby: undefined,
      }));
      const generated = alignGeneratedLyrics(source, new Map([[0, ALIGNMENT_RESULT]]))!;
      const input = {
        content: toTTML(source),
        format: "ttml" as const,
        romaji: createTranslationTrack(
          generated,
          new Map([[0, generated[0].romanizationWords!]]),
          "und-Latn",
        ),
        romajiFormat: "ttml" as const,
      };
      const loaded: LyricLine[] = parseLyric(input).lines;
      applyTimedAuxiliary(loaded, input);
      expect(loaded[0].words.map((word) => word.romanWord)).toEqual(["kimi", "to", "aruku"]);
    },
  );

  it("译文区间不包含未发送的空白词时间，也不保留其旧音译", () => {
    const source = structuredClone(ALIGNMENT_LINES);
    source[0].words.splice(1, 0, {
      word: " ",
      startTime: 0,
      endTime: 9000,
      romanWord: "stale",
    });
    const result = alignGeneratedLyrics(
      source,
      new Map([
        [
          0,
          {
            translation: [{ text: "与你同行", from: 0, to: 3 }],
            romanization: [
              { index: 0, text: "kimi" },
              { index: 2, text: "to" },
              { index: 3, text: "aruku" },
            ],
          },
        ],
      ]),
    )!;
    expect(result[0].translationWords).toEqual([
      { word: "与你同行", startTime: 1100, endTime: 4000 },
    ]);
    expect(result[0].words[1].romanWord).toBeUndefined();
    expect(source[0].words[1].romanWord).toBe("stale");
  });

  it("按原字词区间生成语义译文和音译，不均摊或修改原文时间，保留注音", () => {
    const before = structuredClone(ALIGNMENT_LINES);
    const result = aligned()[0];
    expect(result.translationWords).toEqual([
      { word: "Walk ", startTime: 2200, endTime: 4000 },
      { word: "with ", startTime: 1700, endTime: 2000 },
      { word: "you", startTime: 1100, endTime: 1600 },
    ]);
    expect(result.words.map((word) => word.romanWord)).toEqual(["kimi", "to", "aruku"]);
    expect(result.translatedLyric).toBe("Walk with you");
    expect(result.romanLyric).toBe("kimi to aruku");
    expect(result.words.map(({ romanWord: _roman, ...word }) => word)).toEqual(before[0].words);
    expect(ALIGNMENT_LINES).toEqual(before);
    expect(alignGeneratedLyrics(ALIGNMENT_LINES, new Map())).toBeNull();
  });

  it("独立 TTML 轨道重载后恢复逐字译文与逐词音译", () => {
    const lines = aligned();
    const input = {
      content: toTTML(ALIGNMENT_LINES),
      format: "ttml" as const,
      translation: createTranslationTrack(lines, new Map([[0, lines[0].translationWords!]]), "en"),
      translationFormat: "ttml" as const,
      romaji: createTranslationTrack(
        lines,
        new Map([[0, lines[0].romanizationWords!]]),
        "und-Latn",
      ),
      romajiFormat: "ttml" as const,
    };
    const loaded: LyricLine[] = parseLyric(input).lines;
    applyTimedAuxiliary(loaded, input);
    expect(loaded[0].translationWords).toEqual(lines[0].translationWords);
    expect(loaded[0].romanizationWords).toEqual(lines[0].romanizationWords);
    expect(loaded[0].words.map((word) => word.romanWord)).toEqual(["kimi", "to", "aruku"]);
    const saved = createLyricSaveContent(
      { id: "fixture", title: "原创", source: "local", artists: [], duration: 5000 },
      lines,
      input.content,
      input,
    );
    for (const [format, content] of [["ttml", saved.ttml!]] as const) {
      const current: LyricLine[] = parseLyric({ content, format }).lines;
      applyTimedAuxiliary(current, { content, format });
      expect(current[0].translationWords, format).toEqual(lines[0].translationWords);
      expect(current[0].romanizationWords, format).toEqual(lines[0].romanizationWords);
      expect(
        current[0].words.map((word) => word.romanWord),
        format,
      ).toEqual(["kimi", "to", "aruku"]);
      expect(
        current[0].words.map(({ word, startTime, endTime }) => ({ word, startTime, endTime })),
        format,
      ).toEqual(
        ALIGNMENT_LINES[0].words.map(({ word, startTime, endTime }) => ({
          word,
          startTime,
          endTime,
        })),
      );
    }
    const lrc = parseLyric({ content: saved.lrc, format: "lrc" }).lines;
    expect(lrc[0].translatedLyric).toBe("Walk with you");
    expect(lrc[0].romanLyric).toBe("kimi to aruku");
  });
});
