import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LyricLine } from "@shared/types/lyrics";
import { nextTick } from "vue";
import { normalizeLyricLines, parseLyric } from "lyric-kit";
import { useSettingsStore } from "@/stores/settings";
import { applyTimedAuxiliary } from "@/utils/lyric/auxiliary";
import { createTranslationTrack } from "@/utils/lyric/translation";
import DefaultLyrics from "./DefaultLyrics.vue";
import Lyrics from "./index.vue";

vi.mock("./LyricCredit.vue", () => ({ default: { template: "<span />" } }));
vi.mock("./AMLLLyrics.vue", () => ({ default: { template: "<div />" } }));
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
    const wrapper = mount(Lyrics, { props: { lyricLines: [makeLine("正文")] } });
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
    const wrapper = mount(DefaultLyrics, { props: { lyricLines: [makeLine("旧歌词")] } });
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
