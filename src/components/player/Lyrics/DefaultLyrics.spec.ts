import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";
import { nextTick } from "vue";
import { normalizeLyricLines, parseLyric } from "lyric-kit";
import { useSettingsStore } from "@/stores/settings";
import { applyTimedAuxiliary } from "@/utils/lyric/auxiliary";
import { createTranslationTrack } from "@/utils/lyric/translation";
import { applyLocalAlignment } from "@/services/lyric/localAlignment";
import { applyGeneratedLyrics } from "@/utils/lyric/alignment";
import { createLyricSaveContent } from "@/utils/lyric/save";
import {
  ROMANIZATION_RANGE_LINE,
  ROMANIZATION_RANGE_OPTIONS,
  ROMANIZATION_RANGE_RESULT,
} from "@shared/testFixtures/lyricRomanization";
import DefaultLyrics from "./DefaultLyrics.vue";
import Lyrics from "./index.vue";

vi.mock("./LyricCredit.vue", () => ({ default: { template: "<span />" } }));

vi.mock("@/stores/settings", async () => {
  const { reactive } = await import("vue");
  const settings = reactive({
    lyric: {
      engine: "physics",
      alignment: "auto",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
    },
  });
  return { useSettingsStore: () => settings };
});

const lyricGlobals = {
  components: { DefaultLyrics },
  stubs: { AMLLLyrics: true, LyricCredit: true },
};

const makeLine = (word: string): LyricLine => ({
  startTime: 1000,
  endTime: 2000,
  words: [{ word, startTime: 1000, endTime: 2000 }],
  translatedLyric: "译文",
  romanLyric: "",
  isBG: false,
  isDuet: false,
});

describe("默认歌词引擎显示与配置", () => {
  beforeEach(() => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    useSettingsStore().lyric.alignment = "auto";
  });

  afterEach(() => vi.unstubAllGlobals());

  it("辅助歌词初始化完成并经过两帧布局后向播放器报告就绪", async () => {
    let callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      }),
    );
    const wrapper = mount(Lyrics, {
      props: { lyricLines: [makeLine("正文")] },
      global: lyricGlobals,
    });
    try {
      await flushPromises();
      expect(wrapper.emitted("ready")).toBeUndefined();
      for (let frame = 0; frame < 2; frame++) {
        const pending = callbacks;
        callbacks = [];
        for (const callback of pending) callback(performance.now());
        await flushPromises();
      }
      expect(wrapper.emitted("ready")).toEqual([[]]);
      expect(wrapper.get(".lp-sub").text()).toBe("译文");
    } finally {
      wrapper.unmount();
    }
  });

  it.each([false, true])(
    "范围音译跨对应主词显示，强调开关 %s 及保存重读保留独立高亮",
    async (emphasize) => {
      const lines = applyGeneratedLyrics(
        [structuredClone(ROMANIZATION_RANGE_LINE)],
        new Map([[0, ROMANIZATION_RANGE_RESULT]]),
        ROMANIZATION_RANGE_OPTIONS,
      )!;
      const before = structuredClone(lines);
      const wrapper = mount(DefaultLyrics, {
        props: { lyricLines: lines, playing: false, enableEmphasizeEffect: emphasize },
      });
      try {
        const groups = wrapper.findAll(".lp-roman-range");
        expect(groups.map((group) => group.get(".lp-roman-range-main").text())).toEqual([
          "愛し",
          "感謝",
          "持ち",
        ]);
        expect(groups.map((group) => group.get(".lp-roman-word").text())).toEqual([
          "i to shi",
          "ka n sha",
          "mo chi",
        ]);
        expect(wrapper.findAll(".lp-roman-word").map((word) => word.text())).toEqual([
          "i to shi",
          "sa",
          "to",
          "ka n sha",
          "no",
          "ki",
          "mo chi",
          "wo",
        ]);
        const chars = groups[0].get(".lp-roman-range-main").findAll(":scope > span");
        expect(chars.map((word) => word.text())).toEqual(["愛", "し"]);
        wrapper.vm.setCurrentTime(1300);
        const frames = vi.mocked(requestAnimationFrame).mock.calls.map(([callback]) => callback);
        for (const frame of frames) frame(performance.now());
        expect(chars[0].attributes("style")).toContain("940");
        expect(chars[1].attributes("style")).toContain("1140");
        const html = groups.map((group) => group.html());
        const saved = createLyricSaveContent(
          { id: "range", source: "local", title: "范围音译", artists: [], duration: 3200 },
          lines,
        );
        const input = { content: saved.lrc, format: "lrc" as const };
        const reloaded: LyricLine[] = parseLyric(input).lines;
        applyTimedAuxiliary(reloaded, input);
        await wrapper.setProps({ lyricLines: reloaded });
        for (const [frame] of vi.mocked(requestAnimationFrame).mock.calls.slice(frames.length))
          frame(performance.now());
        expect(wrapper.findAll(".lp-roman-range").map((group) => group.html())).toEqual(html);
        await wrapper.setProps({ showWordRomanization: false });
        expect(wrapper.findAll(".lp-roman-range")).toHaveLength(0);
        expect(wrapper.findAll(".lp-sub").at(-1)?.text()).toBe(lines[0].romanLyric);
        await wrapper.setProps({ showWordRomanization: true });
        expect(wrapper.findAll(".lp-roman-range")).toHaveLength(3);
        expect(lines).toEqual(before);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it("仅应用部分语义候选后，所有译文立即沿用逐字开关且保存重读显示一致", async () => {
    const lines = [0, 1, 2].map((index): LyricLine => ({
      ...makeLine(""),
      startTime: 1000 + index * 2000,
      endTime: 2000 + index * 2000,
      words: [
        { word: "君", startTime: 1000 + index * 2000, endTime: 1400 + index * 2000 },
        { word: "と", startTime: 1400 + index * 2000, endTime: 1600 + index * 2000 },
        { word: "夢", startTime: 1600 + index * 2000, endTime: 2000 + index * 2000 },
      ],
      translatedLyric: "与你梦想",
    }));
    const wrapper = mount(DefaultLyrics, {
      props: { lyricLines: lines, playing: false, showWordTranslation: false },
    });
    try {
      wrapper.vm.setCurrentTime(1500);
      expect(wrapper.find("[data-aux-word]").exists()).toBe(false);
      const updated = applyLocalAlignment(lines, [
        {
          id: 1,
          translation: {
            score: 1,
            parts: [
              { text: "与你", from: 0, to: 1 },
              { text: "梦想", from: 2, to: 2 },
            ],
          },
        },
      ])!;
      await wrapper.setProps({ lyricLines: updated, showWordTranslation: true });
      expect(wrapper.findAll(".timed-auxiliary")).toHaveLength(3);
      expect(
        wrapper.findAll("[data-aux-word]").map((word) => word.attributes("data-aux-state")),
      ).toEqual(["active", "unplayed", "unplayed", "unplayed"]);
      expect(updated[0].translationWords).toBeUndefined();
      const before = wrapper.findAll(".timed-auxiliary").map((row) => row.element.innerHTML);
      const content = lines
        .map(
          (line) =>
            `[00:${(line.startTime / 1000).toFixed(3)}]` +
            line.words
              .map((word) => `<00:${(word.startTime / 1000).toFixed(3)}>${word.word}`)
              .join("") +
            `<00:${(line.endTime / 1000).toFixed(3)}>`,
        )
        .join("\n");
      const input = {
        content,
        format: "lrc" as const,
        translation: createTranslationTrack(
          updated,
          new Map(
            updated.map((line, index) => [index, line.translationWords ?? line.translatedLyric]),
          ),
          "zh-CN",
          "normalized",
        ),
        translationFormat: "ttml" as const,
      };
      const reloaded: LyricLine[] = parseLyric(input).lines;
      applyTimedAuxiliary(reloaded, input);
      await wrapper.setProps({ lyricLines: reloaded });
      expect(wrapper.findAll(".timed-auxiliary").map((row) => row.element.innerHTML)).toEqual(
        before,
      );
    } finally {
      wrapper.unmount();
    }
  });

  it("暂停时应用和重做对齐立即刷新副行及当前进度，无需保存或推进播放", async () => {
    const line: LyricLine = {
      ...makeLine(""),
      words: [
        { word: "君", startTime: 1000, endTime: 1400 },
        { word: "と", startTime: 1400, endTime: 1600 },
        { word: "夢", startTime: 1600, endTime: 2000 },
      ],
      romanLyric: "kimi to yume",
    };
    const wrapper = mount(DefaultLyrics, {
      props: {
        lyricLines: [line],
        playing: false,
        showWordRomanization: false,
        showWordTranslation: false,
      },
    });
    try {
      wrapper.vm.setCurrentTime(1500);
      const aligned = applyLocalAlignment(
        [line],
        [
          {
            id: 0,
            romanization: {
              score: 1,
              parts: [
                { text: "kimi to ", from: 0, to: 1 },
                { text: "yume", from: 2, to: 2 },
              ],
            },
          },
        ],
      )!;
      await wrapper.setProps({ lyricLines: aligned });
      expect(wrapper.findAll("[data-aux-word]").map((word) => word.text())).toEqual([
        "kimi to",
        "yume",
      ]);
      expect(
        wrapper.findAll("[data-aux-word]").map((word) => word.attributes("data-aux-state")),
      ).toEqual(["active", "unplayed"]);
      const realigned = applyLocalAlignment(
        aligned,
        [
          {
            id: 0,
            romanization: {
              score: 1,
              parts: [
                { text: "kimi ", from: 0, to: 0 },
                { text: "to ", from: 1, to: 1 },
                { text: "yume", from: 2, to: 2 },
              ],
            },
          },
        ],
        true,
      )!;
      await wrapper.setProps({ lyricLines: realigned });
      expect(wrapper.findAll("[data-aux-word]").map((word) => word.text())).toEqual([
        "kimi",
        "to",
        "yume",
      ]);
      expect(
        wrapper.findAll("[data-aux-word]").map((word) => word.attributes("data-aux-state")),
      ).toEqual(["played", "active", "unplayed"]);
      expect(realigned[0].words.map(({ romanWord: _roman, ...word }) => word)).toEqual(line.words);
      await wrapper.setProps({ showWordRomanization: true });
      expect(wrapper.findAll(".lp-roman-word").map((word) => word.text())).toEqual([
        "kimi",
        "to",
        "yume",
      ]);
    } finally {
      wrapper.unmount();
    }
  });

  it.each(["lrc", "ttml"] as const)(
    "%s 整句音译不重复，并保留主词高亮和副行顺序",
    async (format) => {
      const content =
        "[03:02.000]鼓動のせい ぱっちり目が覚めた\n[03:08.300]\n" +
        "[03:35.930]今真っ直ぐに 君を見つめた\n[03:40.660]";
      const romanization = [
        "ko do u no se i pa tchi ri me ga sa me ta",
        "i ma ma ssu gu ni ki mi wo mi tsu me ta",
      ];
      const translation = ["却偏偏心跳得太厉害 让我猛然睁开眼", "此刻只想 目不转睛看着你"];
      const source = parseLyric(content).lines;
      normalizeLyricLines(source);
      const input = {
        content,
        format: "lrc" as const,
        translation: `[03:02.000]${translation[0]}\n[03:35.930]${translation[1]}`,
        romaji:
          format === "lrc"
            ? `[03:02.000]${romanization[0]}\n[03:35.930]${romanization[1]}`
            : createTranslationTrack(
                source,
                new Map(
                  source.map((line, index) => [
                    index,
                    [
                      {
                        word: romanization[index],
                        startTime: line.startTime,
                        endTime: line.endTime,
                      },
                    ],
                  ]),
                ),
                "und-Latn",
                "normalized",
              ),
        romajiFormat: format,
      };
      const lines: LyricLine[] = parseLyric(input).lines;
      applyTimedAuxiliary(lines, input);
      normalizeLyricLines(lines);
      const wrapper = mount(DefaultLyrics, { props: { lyricLines: lines } });
      try {
        expect(lines.map((line) => line.words[0].romanWord)).toEqual(romanization);
        expect(wrapper.findAll(".lp-roman-word").map((row) => row.text())).toEqual(romanization);
        expect(wrapper.findAll(".lp-word-text").map((row) => row.text())).toEqual(
          source.map((line) => line.words.map((word) => word.word).join("")),
        );
        expect(wrapper.findAll(".lp-sub").map((row) => row.text())).toEqual(translation);
        for (const [index, row] of wrapper.findAll(".lp-line").entries()) {
          expect(row.text().split(romanization[index])).toHaveLength(2);
          expect(row.findAll(".lp-word-roman")).toHaveLength(1);
          const roman = row.get(".lp-roman-word").element;
          const translated = row.get(".lp-sub").element;
          expect(
            roman.compareDocumentPosition(translated) & Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        }
        wrapper.vm.setCurrentTime(185150);
        const frames = vi.mocked(requestAnimationFrame).mock.calls.map(([callback]) => callback);
        for (const frame of frames) frame(performance.now());
        const activeLine = wrapper.get(".lp-line").element as HTMLElement;
        expect(activeLine.style.getPropertyValue("--t")).toBe("185150");
        expect(lines.map((line) => line.words[0])).toEqual(
          source.map((line, index) => ({ ...line.words[0], romanWord: romanization[index] })),
        );
        await wrapper.setProps({ showWordRomanization: false });
        expect(wrapper.findAll(".lp-roman-word")).toHaveLength(0);
        expect(wrapper.findAll(".lp-sub").map((row) => row.text())).toEqual(
          translation.flatMap((text, index) => [text, romanization[index]]),
        );
        await wrapper.setProps({ showRomanization: false });
        expect(wrapper.findAll(".lp-sub").map((row) => row.text())).toEqual(translation);
      } finally {
        wrapper.unmount();
      }
    },
  );

  it("真实逐字片段保留各自的主词、音译与时间，不跨片段合并", () => {
    const line: LyricLine = {
      ...makeLine(""),
      startTime: 182000,
      endTime: 188300,
      words: [
        {
          word: "鼓動 のせい",
          romanWord: "ko do u no se i",
          startTime: 182000,
          endTime: 184000,
        },
        {
          word: "ぱっちり 目が覚めた",
          romanWord: "pa tchi ri me ga sa me ta",
          startTime: 184000,
          endTime: 188300,
        },
      ],
    };
    const original = structuredClone(line);
    const wrapper = mount(DefaultLyrics, { props: { lyricLines: [line] } });
    try {
      expect(wrapper.findAll(".lp-word-text").map((word) => word.text())).toEqual(
        original.words.map((word) => word.word),
      );
      expect(wrapper.findAll(".lp-roman-word").map((word) => word.text())).toEqual(
        original.words.map((word) => word.romanWord),
      );
      expect(wrapper.findAll(".lp-word-roman")).toHaveLength(2);
      expect(line).toEqual(original);
    } finally {
      wrapper.unmount();
    }
  });

  it("应用歌词设置直接驱动默认引擎的水平对齐", async () => {
    const settings = useSettingsStore();
    const wrapper = mount(Lyrics, {
      props: { lyricLines: [makeLine("正文")] },
      global: lyricGlobals,
    });
    try {
      const root = wrapper.get(".lp-root");
      expect(root.classes().filter((value) => value.startsWith("lp-align-"))).toEqual([]);
      settings.lyric.alignment = "center";
      await nextTick();
      expect(root.classes()).toContain("lp-align-center");
      settings.lyric.alignment = "right";
      await nextTick();
      expect(root.classes()).toContain("lp-align-right");
    } finally {
      wrapper.unmount();
    }
  });

  it("初始化和动态切换水平对齐保留原歌词 DOM，auto 恢复声部布局", async () => {
    const wrapper = mount(DefaultLyrics, {
      props: { lyricLines: [makeLine("正文")], alignment: "center" },
      global: lyricGlobals,
    });
    try {
      const original = wrapper.get(".lp-line").element;
      expect(wrapper.classes()).toContain("lp-align-center");
      for (const alignment of ["right", "left", "auto"] as const) {
        await wrapper.setProps({ alignment });
        expect(wrapper.get(".lp-line").element).toBe(original);
        const classes = wrapper.classes().filter((value) => value.startsWith("lp-align-"));
        expect(classes).toEqual(alignment === "auto" ? [] : [`lp-align-${alignment}`]);
      }
    } finally {
      wrapper.unmount();
    }
  });

  it("冻结时缓冲歌词更换，恢复后使用最新歌词和对齐配置", async () => {
    const wrapper = mount(DefaultLyrics, {
      props: { lyricLines: [makeLine("旧歌词")] },
      global: lyricGlobals,
    });
    try {
      wrapper.vm.freeze();
      await wrapper.setProps({ lyricLines: [makeLine("新歌词")], alignment: "right" });
      expect(wrapper.get(".lp-main").text()).toBe("旧歌词");
      wrapper.vm.resume();
      expect(wrapper.get(".lp-main").text()).toBe("新歌词");
      expect(wrapper.classes()).toContain("lp-align-right");
    } finally {
      wrapper.unmount();
    }
  });
});
