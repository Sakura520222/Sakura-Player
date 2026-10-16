import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { nextTick, reactive, toRaw } from "vue";
import { parseLyric, toTTML } from "lyric-kit";
import { ALIGNMENT_LINES, ALIGNMENT_RESULT } from "@shared/testFixtures/lyricAlignment";
import type { LyricLine } from "@shared/types/lyrics";
import type { CjkTransformMode } from "@shared/types/opencc";
import {
  GENERATION_TASKS,
  getGenerationCoverage,
  type GeneratedLyric,
  type GenerationOptions,
} from "@/services/lyric/aiGeneration";

let settings: {
  locale: string;
  lyric: { cjkTransform: CjkTransformMode; detectBackgroundLyrics: boolean };
};
const mocks = vi.hoisted(() => ({ transform: vi.fn(), update: vi.fn() }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => settings }));
vi.mock("@/services/lyric/loader", () => ({ watchLyricPreference: vi.fn() }));
vi.mock("@/utils/lyric/lyricStripper", () => ({
  applyLyricExclude: (lines: LyricLine[]) => lines,
}));
vi.mock("@/utils/lyric/cjkTransform", () => ({ applyLyricCjkTransform: mocks.transform }));
import { useMediaStore } from "./media";

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  settings = reactive({
    locale: "zh-CN",
    lyric: { cjkTransform: "none", detectBackgroundLyrics: true },
  });
  mocks.transform.mockReset().mockImplementation(async (lines) => lines);
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { nowPlaying: { update: mocks.update } },
  });
});
afterEach(() => disposePinia(pinia));

const load = () => {
  const media = useMediaStore();
  media.setTrack({ id: "song", source: "local", title: "Fixture", artists: [], duration: 5000 });
  media.setLyric(
    { source: "embedded", format: "lrc" },
    { content: "[00:01]Light\n[00:03]Rain", romaji: "[00:01]roman one\n[00:03]roman two" },
  );
  return media;
};
const translations = new Map([
  [0, "灯光"],
  [1, "雨声"],
]);

describe("当前歌曲 AI 译文应用", () => {
  it("已有译文的空关联规范化后可应用与重载，原词和逐字完整状态均保留", () => {
    const media = load();
    const content = toTTML(ALIGNMENT_LINES);
    media.setLyric({ source: "embedded", format: "ttml" }, { content });
    media.applyLyricTranslation(media.lyricRevision, new Map([[0, "You walk"]]), "en");
    const words = structuredClone(media.parsedLyric[0].words);
    expect(
      media.applyGeneratedLyric(
        media.lyricRevision,
        new Map([
          [
            0,
            {
              translation: [
                { text: "You ", from: 0, to: 0 },
                { text: "", from: 1, to: 1 },
                { text: "walk", from: 2, to: 2 },
              ],
            },
          ],
        ]),
        { translation: false, romanization: false, wordTranslation: true, wordRomanization: false },
        "zh-CN",
      ),
    ).toBe(true);
    const applied = structuredClone(media.parsedLyric[0]);
    expect(applied.translatedLyric).toBe("You walk");
    expect(applied.translationWords?.every((span) => span.word.trim())).toBe(true);
    expect(getGenerationCoverage(media.parsedLyric).existing.wordTranslation).toBe(1);
    media.setLyric(media.activeLyric, media.lyricContent);
    expect(media.parsedLyric[0].translatedLyric).toBe("You walk");
    expect(media.parsedLyric[0].translationWords).toEqual(applied.translationWords);
    expect(media.parsedLyric[0].words).toEqual(words);
    expect(getGenerationCoverage(media.parsedLyric).existing.wordTranslation).toBe(1);
    expect(media.lyricContent!.content).toBe(content);
  });

  it("补齐缺失行后保存重载，完整行的译文、逐字时间和未选音译均保持原样", () => {
    const media = load();
    const source = Array.from({ length: 3 }, (_, index) => ({
      ...structuredClone(ALIGNMENT_LINES[0]),
      startTime: ALIGNMENT_LINES[0].startTime + index * 5000,
      endTime: ALIGNMENT_LINES[0].endTime + index * 5000,
      words: ALIGNMENT_LINES[0].words.map((word) => ({
        ...word,
        startTime: word.startTime + index * 5000,
        endTime: word.endTime + index * 5000,
      })),
    }));
    const content = toTTML(source);
    media.setLyric({ source: "embedded", format: "ttml" }, { content });
    expect(
      media.applyAlignedLyricTranslation(
        media.lyricRevision,
        new Map([0, 1, 2].map((id) => [id, ALIGNMENT_RESULT])),
        "en",
      ),
    ).toBe(true);
    const before = structuredClone(media.parsedLyric);
    const originalRomanTrack = media.lyricContent!.romaji;
    const unchanged = media.parsedLyric[0];
    media.parsedLyric = media.parsedLyric.map((line, id) =>
      id === 0
        ? line
        : {
            ...line,
            translationWords: undefined,
            translatedLyric: id === 2 ? "" : line.translatedLyric,
          },
    );
    const options = {
      translation: true,
      romanization: false,
      wordTranslation: true,
      wordRomanization: false,
    };
    expect(
      media.applyGeneratedLyric(
        media.lyricRevision,
        new Map([
          [1, { translation: ALIGNMENT_RESULT.translation }],
          [2, { translation: [{ text: "补齐译文", from: 0, to: 2 }] }],
        ]),
        options,
        "zh-CN",
        "missing",
      ),
    ).toBe(true);
    expect(media.parsedLyric[0]).toBe(unchanged);
    expect(media.parsedLyric[1].translatedLyric).toBe(before[1].translatedLyric);
    expect(media.parsedLyric[2].translatedLyric).toBe("补齐译文");
    expect(media.lyricContent!.romaji).toBe(originalRomanTrack);
    expect(media.lyricContent!.content).toBe(content);
    media.setLyric(media.activeLyric, media.lyricContent);
    expect(media.parsedLyric[0].translationWords).toEqual(before[0].translationWords);
    expect(media.parsedLyric.map((line) => line.words)).toEqual(before.map((line) => line.words));
    expect(media.parsedLyric[1].translatedLyric).toBe("Walk with you");
    expect(media.parsedLyric[2].translatedLyric).toBe("补齐译文");
  });

  it("仅对齐缺失的逐字轨道时保留已有文本语言，完整模式可替换已有文本", () => {
    const media = load();
    media.setLyric({ source: "embedded", format: "ttml" }, { content: toTTML(ALIGNMENT_LINES) });
    media.applyAlignedLyricTranslation(media.lyricRevision, new Map([[0, ALIGNMENT_RESULT]]), "en");
    media.parsedLyric = media.parsedLyric.map((line) => ({ ...line, translationWords: undefined }));
    const options = {
      translation: false,
      romanization: false,
      wordTranslation: true,
      wordRomanization: false,
    };
    expect(
      media.applyGeneratedLyric(
        media.lyricRevision,
        new Map([[0, { translation: ALIGNMENT_RESULT.translation }]]),
        options,
        "zh-CN",
        "missing",
      ),
    ).toBe(true);
    expect(
      parseLyric(
        { content: media.lyricContent!.translation!, format: "ttml" },
        { extractMetadata: true },
      ).metadata.language,
    ).toBe("en");
    expect(
      media.applyGeneratedLyric(
        media.lyricRevision,
        new Map([[0, { translation: [{ text: "完整重做", from: 0, to: 2 }] }]]),
        options,
        "zh-CN",
        "full",
      ),
    ).toBe(true);
    expect(media.parsedLyric[0].translatedLyric).toBe("完整重做");
    media.setLyric(media.activeLyric, media.lyricContent);
    expect(media.parsedLyric[0].translatedLyric).toBe("完整重做");
  });

  it.each(Array.from({ length: 15 }, (_, index) => index + 1))(
    "完整生成选择组合 %s 只修改所选轨道，原文、注音和保存重载保持一致",
    (mask) => {
      const media = load();
      const content = toTTML(ALIGNMENT_LINES);
      media.setLyric({ source: "embedded", format: "ttml" }, { content });
      media.applyAlignedLyricTranslation(
        media.lyricRevision,
        new Map([[0, ALIGNMENT_RESULT]]),
        "en",
      );
      const before = structuredClone(media.parsedLyric[0]);
      const saved = { ...toRaw(media.lyricContent!) };
      const options = Object.fromEntries(
        GENERATION_TASKS.map((key, bit) => [key, !!(mask & (1 << bit))]),
      ) as GenerationOptions;
      const value: GeneratedLyric = {};
      if (options.wordTranslation)
        value.translation = options.translation
          ? [{ text: "新的译文", from: 0, to: 2 }]
          : ALIGNMENT_RESULT.translation;
      else if (options.translation) value.translation = "新的逐行译文";
      if (options.wordRomanization)
        value.romanization = options.romanization
          ? [{ index: 0, text: "anata" }, ...ALIGNMENT_RESULT.romanization.slice(1)]
          : ALIGNMENT_RESULT.romanization;
      else if (options.romanization) value.romanization = "anata to aruku";
      expect(
        media.applyGeneratedLyric(
          media.lyricRevision,
          new Map([[0, value]]),
          options,
          "zh-CN",
          "full",
        ),
      ).toBe(true);
      const applied = structuredClone(media.parsedLyric[0]);
      if (!options.translation && !options.wordTranslation) {
        expect(applied.translatedLyric).toBe(before.translatedLyric);
        expect(applied.translationWords).toEqual(before.translationWords);
        expect(media.lyricContent!.translation).toBe(saved.translation);
      }
      if (!options.romanization && !options.wordRomanization) {
        expect(applied.romanLyric).toBe(before.romanLyric);
        expect(applied.words).toEqual(before.words);
        expect(media.lyricContent!.romaji).toBe(saved.romaji);
      }
      if (options.wordTranslation && !options.translation) {
        expect(applied.translatedLyric).toBe(before.translatedLyric);
        expect(
          parseLyric(
            { content: media.lyricContent!.translation!, format: "ttml" },
            { extractMetadata: true },
          ).metadata.language,
        ).toBe("zh-CN");
      }
      if (options.translation && !options.wordTranslation)
        expect(applied.translationWords).toBeUndefined();
      if (options.romanization && !options.wordRomanization) {
        expect(applied.romanizationWords).toBeUndefined();
        expect(applied.words.every((word) => !word.romanWord)).toBe(true);
      }
      expect(media.lyricContent!.content).toBe(content);
      expect(applied.words.map(({ romanWord: _roman, ...word }) => word)).toEqual(
        before.words.map(({ romanWord: _roman, ...word }) => word),
      );
      media.setLyric(media.activeLyric, media.lyricContent);
      expect(media.parsedLyric[0].translatedLyric).toBe(applied.translatedLyric);
      expect(media.parsedLyric[0].romanLyric).toBe(applied.romanLyric);
      expect(media.parsedLyric[0].translationWords).toEqual(applied.translationWords);
      expect(media.parsedLyric[0].words).toEqual(applied.words);
    },
  );

  it("逐字单选不得改写已有文本或应用不完整结果，失败时不修改状态", () => {
    const media = load();
    media.setLyric({ source: "embedded", format: "ttml" }, { content: toTTML(ALIGNMENT_LINES) });
    media.applyAlignedLyricTranslation(media.lyricRevision, new Map([[0, ALIGNMENT_RESULT]]), "en");
    media.parsedLyric = media.parsedLyric.map((line) => ({ ...line, translationWords: undefined }));
    const current = media.parsedLyric;
    const revision = media.lyricRevision;
    const options = {
      translation: false,
      romanization: false,
      wordTranslation: true,
      wordRomanization: false,
    };
    expect(media.applyGeneratedLyric(revision, new Map(), options, "en")).toBe(false);
    expect(
      media.applyGeneratedLyric(
        revision,
        new Map([[0, { translation: [{ text: "rewrite", from: 0, to: 2 }] }]]),
        options,
        "en",
      ),
    ).toBe(false);
    expect(media.parsedLyric).toBe(current);
    expect(media.lyricRevision).toBe(revision);
  });
  it("逐字结果原子写入两条辅助轨道并同步窗口，重载和切换普通翻译时状态正确", () => {
    const media = load();
    const content = toTTML(ALIGNMENT_LINES);
    media.setLyric({ source: "embedded", format: "ttml" }, { content });
    const revision = media.lyricRevision;
    expect(media.applyAlignedLyricTranslation(revision, new Map(), "en")).toBe(false);
    expect(
      media.applyAlignedLyricTranslation(revision - 1, new Map([[0, ALIGNMENT_RESULT]]), "en"),
    ).toBe(false);
    expect(
      media.applyAlignedLyricTranslation(revision, new Map([[0, ALIGNMENT_RESULT]]), "en"),
    ).toBe(true);
    const line = structuredClone(media.parsedLyric[0]);
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ lyric: media.parsedLyric }),
    );
    expect(media.lyricContent?.content).toBe(content);
    media.setLyric(media.activeLyric, media.lyricContent);
    expect(media.parsedLyric[0].translationWords).toEqual(line.translationWords);
    expect(media.parsedLyric[0].words.map((word) => word.romanWord)).toEqual([
      "kimi",
      "to",
      "aruku",
    ]);
    media.applyLyricTranslation(media.lyricRevision, new Map([[0, "新的逐行译文"]]), "zh-CN");
    expect(media.parsedLyric[0].translationWords).toBeUndefined();
    media.setLyric(media.activeLyric, media.lyricContent);
    expect(media.parsedLyric[0].translatedLyric).toBe("新的逐行译文");
    expect(media.parsedLyric[0].translationWords).toBeUndefined();
  });

  it.each(["aligned", "line"])("%s 经过大时间差、声部配对和多次重载后不丢行", (mode) => {
    const media = load();
    const content = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s" end="5s"><span begin="3s" end="4s">A</span></p><p begin="3s" end="8s"><span begin="6s" end="7s">B</span><span ttm:role="x-bg" begin="6s" end="8s"><span begin="6s" end="8s">C</span></span></p></div></body></tt>`;
    media.setLyric({ source: "embedded", format: "ttml" }, { content });
    if (mode === "aligned") {
      expect(
        media.applyAlignedLyricTranslation(
          media.lyricRevision,
          new Map(
            media.parsedLyric.map((line, index) => [
              index,
              {
                translation: [{ text: `译文${index}`, from: 0, to: 0 }],
                romanization: [{ index: 0, text: line.words[0].word }],
              },
            ]),
          ),
          "zh-CN",
        ),
      ).toBe(true);
    } else {
      expect(
        media.applyLyricTranslation(
          media.lyricRevision,
          new Map(media.parsedLyric.map((_, index) => [index, `译文${index}`])),
          "zh-CN",
        ),
      ).toBe(true);
    }
    const before = structuredClone(media.parsedLyric);
    for (let reload = 0; reload < 2; reload++) {
      media.setLyric(media.activeLyric, media.lyricContent);
      expect(media.parsedLyric.map((line) => line.translatedLyric)).toEqual([
        "译文0",
        "译文1",
        "译文2",
      ]);
      expect(media.parsedLyric.map((line) => line.translationWords)).toEqual(
        before.map((line) => line.translationWords),
      );
      expect(media.parsedLyric.map((line) => line.words)).toEqual(before.map((line) => line.words));
      expect(media.lyricContent?.content).toBe(content);
    }
  });
  it("完整结果一次性应用并同步歌词窗口，原文、时间和音译不变，重新解析仍保留译文", () => {
    const media = load();
    const input = structuredClone(toRaw(media.lyricContent));
    const original = structuredClone(media.parsedLyric);
    expect(media.applyLyricTranslation(media.lyricRevision, translations, "zh-CN")).toBe(true);
    expect(media.lyricContent?.content).toBe(input?.content);
    expect(media.parsedLyric).toEqual(
      original.map((row, index) => ({ ...row, translatedLyric: translations.get(index) })),
    );
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ lyric: media.parsedLyric }),
    );
    const saved = parseLyric({ ...toRaw(media.lyricContent!), format: "lrc" }).lines;
    expect(saved.map((row) => row.translatedLyric)).toEqual(["灯光", "雨声"]);
    media.setLyric(media.activeLyric, media.lyricContent);
    expect(media.parsedLyric.map((row) => row.translatedLyric)).toEqual(["灯光", "雨声"]);
  });

  it.each(["track", "source", "reset", "clear"])("%s 更新后拒绝旧版本结果", (change) => {
    const media = load();
    const revision = media.lyricRevision;
    if (change === "track") media.setTrack({ ...media.track!, id: "next" });
    else if (change === "source")
      media.setLyric(media.activeLyric, { content: "[00:02]New lyric" });
    else if (change === "reset") media.resetLyricState();
    else media.clear();
    const current = media.parsedLyric;
    expect(media.applyLyricTranslation(revision, translations, "zh-CN")).toBe(false);
    expect(media.parsedLyric).toBe(current);
  });

  it("缺行、多行或空译文都不写入任何状态", () => {
    const media = load();
    const current = media.parsedLyric;
    const revision = media.lyricRevision;
    for (const map of [
      new Map([[0, "一行"]]),
      new Map([...translations, [9, "多行"]] as [number, string][]),
      new Map([
        [0, ""],
        [1, "雨声"],
      ]),
    ]) {
      expect(media.applyLyricTranslation(revision, map, "zh-CN")).toBe(false);
    }
    expect(media.parsedLyric).toBe(current);
    expect(media.lyricRevision).toBe(revision);
  });

  it.each(["apply", "reset", "clear", "replace"])(
    "%s 后旧的简繁转换结果不能覆盖当前歌词",
    async (change) => {
      settings.lyric.cjkTransform = "s2t";
      let resolve!: (lines: LyricLine[]) => void;
      mocks.transform.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const media = load();
      const oldLines = media.parsedLyric.map((row) => ({ ...row, translatedLyric: "stale" }));
      if (change === "apply")
        media.applyLyricTranslation(media.lyricRevision, translations, "zh-CN");
      else if (change === "reset") media.resetLyricState();
      else if (change === "clear") media.clear();
      else {
        settings.lyric.cjkTransform = "none";
        await nextTick();
      }
      const current = media.parsedLyric;
      resolve(oldLines);
      await nextTick();
      expect(media.parsedLyric).toBe(current);
    },
  );
});
