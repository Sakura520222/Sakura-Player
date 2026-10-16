import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { nextTick, reactive, toRaw } from "vue";
import { parseLyric } from "lyric-kit";
import type { LyricLine } from "@shared/types/lyrics";
import type { CjkTransformMode } from "@shared/types/opencc";

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
