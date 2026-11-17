import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, reactive, ref } from "vue";
import type { LyricAlignmentApi, LocalAlignmentResponse } from "@shared/types/lyricAlignment";
import type { LyricLine } from "@shared/types/lyrics";

const api = {
  align: vi.fn<LyricAlignmentApi["align"]>(),
  cancel: vi.fn<LyricAlignmentApi["cancel"]>(),
};
let media: {
  track: object | null;
  parsedLyric: LyricLine[];
  lyricRevision: number;
  lyricLoading: boolean;
  applyLocalLyricAlignment: ReturnType<typeof vi.fn>;
  getLyricExportLines?: () => LyricLine[];
  aiLyricExcludedIds?: Set<number>;
};
vi.mock("@/stores/media", () => ({ useMediaStore: () => media }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./useLyricAlignmentEnvironment", () => ({
  useLyricAlignmentEnvironment: () => ({ ready: ref(true) }),
}));
import { useLocalLyricAlignment } from "./useLocalLyricAlignment";
const wrappers: ReturnType<typeof mount>[] = [];

/** 挂载真实生命周期，便于验证关闭和切歌取消 */
const setup = () => {
  const open = ref(true);
  let state!: ReturnType<typeof useLocalLyricAlignment>;
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          state = useLocalLyricAlignment(open);
          return () => null;
        },
      }),
    ),
  );
  return { ...state, open };
};
const response: LocalAlignmentResponse = {
  status: "completed",
  lines: [
    {
      id: 0,
      romanization: {
        score: 1,
        parts: [
          { text: "kimi ", from: 0, to: 0 },
          { text: "to", from: 1, to: 1 },
        ],
      },
    },
  ],
};

beforeEach(() => {
  media = reactive({
    track: { id: "song" },
    lyricRevision: 1,
    lyricLoading: false,
    applyLocalLyricAlignment: vi.fn(() => true),
    parsedLyric: [
      {
        startTime: 1000,
        endTime: 2000,
        words: [
          { word: "君", startTime: 1000, endTime: 1500 },
          { word: "と", startTime: 1500, endTime: 2000 },
        ],
        translatedLyric: "与你",
        romanLyric: "kimi to",
        isBG: false,
        isDuet: false,
      },
    ],
  });
  api.align.mockReset().mockResolvedValue(response);
  api.cancel.mockReset().mockResolvedValue(true);
  Object.defineProperty(window, "api", { configurable: true, value: { lyricAlignment: api } });
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe("声学主歌词流程", () => {
  it("超过单次行数的歌词一次开始并在内部处理全部批次", async () => {
    media.parsedLyric = Array.from({ length: 1100 }, () => ({
      startTime: 1000,
      endTime: 3000,
      words: [{ word: "Hello world", startTime: 1000, endTime: 3000 }],
      translatedLyric: "",
      romanLyric: "",
      isBG: false,
      isDuet: false,
    }));
    media.getLyricExportLines = () => media.parsedLyric;
    media.aiLyricExcludedIds = new Set();
    api.align.mockImplementation(async (request) => ({
      status: "completed",
      lines: request.lines.map((line) => ({
        id: line.id,
        primary: {
          score: 0.01,
          warnings: ["需要检查"],
          words: [
            { word: "Hello ", startTime: 1100, endTime: 1500 },
            { word: "world", startTime: 1800, endTime: 2500 },
          ],
        },
      })),
    }));
    const state = setup();
    state.primary.value = true;
    state.translation.value = false;
    state.romanization.value = false;
    expect(state.rows.value).toHaveLength(1100);
    await state.start();
    expect(api.align).toHaveBeenCalledTimes(2);
    expect(state.results.value).toHaveLength(1100);
    expect(state.selected.value.size).toBe(1100);
    expect(state.canApply.value).toBe(true);
  });
  it("不需要辅助文本也可处理逐行歌词，选择语言后传入稳定歌曲身份", async () => {
    media.parsedLyric = [
      {
        startTime: 1000,
        endTime: 3000,
        words: [{ word: "Hello world", startTime: 1000, endTime: 3000 }],
        translatedLyric: "",
        romanLyric: "",
        isBG: false,
        isDuet: false,
      },
    ];
    media.getLyricExportLines = () => media.parsedLyric;
    media.aiLyricExcludedIds = new Set();
    api.align.mockResolvedValue({
      status: "completed",
      lines: [
        {
          id: 0,
          primary: {
            score: 0.8,
            words: [
              { word: "Hello ", startTime: 1100, endTime: 1700 },
              { word: "world", startTime: 2000, endTime: 2700 },
            ],
          },
        },
      ],
    });
    const state = setup();
    state.primary.value = true;
    state.language.value = "en";
    state.translation.value = false;
    state.romanization.value = false;
    expect(state.canStart.value).toBe(true);
    await state.start();
    expect(api.align.mock.calls[0][0]).toMatchObject({
      primary: { trackId: "song", language: "en" },
      lines: [{ primary: { startTime: 500, endTime: 3500 } }],
    });
    expect(state.results.value[0].primary?.words).toHaveLength(2);
    expect(state.canApply.value).toBe(true);
    expect(state.apply()?.count).toBe(1);
  });
});

describe("本地歌词对齐任务生命周期", () => {
  it("关闭后立即禁止应用，淡出结束卸载时才释放预览", async () => {
    const state = setup();
    await state.start();
    const results = state.results.value;
    expect(results.length).toBeGreaterThan(0);
    state.open.value = false;
    await flushPromises();
    expect(state.canApply.value).toBe(false);
    expect(state.results.value).toBe(results);
    wrappers.at(-1)!.unmount();
    expect(state.results.value).toEqual([]);
  });
  it("预览不自动应用，选中的现有文本结果可应用", async () => {
    const state = setup();
    await state.start();
    expect(media.applyLocalLyricAlignment).not.toHaveBeenCalled();
    expect(state.canApply.value).toBe(true);
    state.select(0, false);
    expect(state.canApply.value).toBe(false);
    state.select(0, true);
    expect(state.apply()).toEqual({ count: 1, translation: false, romanization: true });
    expect(media.applyLocalLyricAlignment).toHaveBeenCalledWith(
      1,
      response.status === "completed" ? response.lines : [],
      false,
    );
  });
  it("仅统计本次勾选轨道的实际请求，并独立统计已有对齐", async () => {
    const line = media.parsedLyric[0];
    media.parsedLyric.push({ ...line, romanLyric: "" });
    const state = setup();
    state.translation.value = false;
    expect(state.rows.value).toHaveLength(1);
    await state.start();
    expect(api.align.mock.calls[0][0].lines).toHaveLength(1);
    expect(state.coverage.value).toEqual([
      { field: "romanization", total: 1, existing: 0, matched: 1 },
    ]);
    expect(state.fields.value).toEqual(["romanization"]);
    state.translation.value = true;
    line.romanizationWords = [
      { word: "kimi ", startTime: 1000, endTime: 1500 },
      { word: "to", startTime: 1500, endTime: 2000 },
    ];
    expect(state.rows.value).toHaveLength(2);
    expect(state.coverage.value).toEqual([
      { field: "translation", total: 2, existing: 0, matched: 0 },
      { field: "romanization", total: 0, existing: 1, matched: 0 },
    ]);
    expect(state.rows.value[0].original.romanization).toBe("kimi to");
    expect(state.rows.value[0].romanization).toBe("");
    expect(state.rows.value[1].original.romanization).toBe("");
  });
  it.each(["song", "close", "cancel", "loading", "realign"])(
    "%s 使迟到结果失效并取消后台",
    async (mode) => {
      let finish!: (result: LocalAlignmentResponse) => void;
      api.align.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const state = setup();
      const running = state.start();
      if (mode === "song") media.lyricRevision++;
      else if (mode === "close") state.open.value = false;
      else if (mode === "loading") media.lyricLoading = true;
      else if (mode === "realign") state.realignExisting.value = true;
      else state.cancel();
      finish(response);
      await running;
      expect(api.cancel).toHaveBeenCalledTimes(1);
      expect(state.canApply.value).toBe(false);
      expect(state.results.value).toEqual([]);
    },
  );
  it("允许重做已有完整对齐，并把覆盖选择传给应用入口", async () => {
    const line = media.parsedLyric[0];
    line.translationWords = [
      { word: "与", startTime: 1000, endTime: 1500 },
      { word: "你", startTime: 1500, endTime: 2000 },
    ];
    line.romanizationWords = [
      { word: "kimi ", startTime: line.words[0].startTime, endTime: line.words[0].endTime },
      { word: "to", startTime: line.words[1].startTime, endTime: line.words[1].endTime },
    ];
    const state = setup();
    expect(state.rows.value).toEqual([]);
    state.realignExisting.value = true;
    state.translation.value = false;
    expect(state.canStart.value).toBe(true);
    await state.start();
    expect(api.align.mock.calls[0][0].lines[0].translation).toBe("");
    expect(state.canApply.value).toBe(true);
    state.apply();
    expect(media.applyLocalLyricAlignment).toHaveBeenCalledWith(
      1,
      response.status === "completed" ? response.lines : [],
      true,
    );
    state.realignExisting.value = false;
    expect(state.canApply.value).toBe(false);
  });
  it("旧时间虽然覆盖全行，默认仍列为需要处理的音译", () => {
    media.parsedLyric[0].romanizationWords = [
      { word: "kimi ", startTime: 1000, endTime: 1200 },
      { word: "to", startTime: 1200, endTime: 2000 },
    ];
    const state = setup();
    state.translation.value = false;
    expect(state.rows.value).toHaveLength(1);
    expect(state.rows.value[0].romanization).toBe("kimi to");
    expect(state.canStart.value).toBe(true);
  });
  it("更改选项清空预览，未选择的辅助文本不传入后台", async () => {
    const state = setup();
    state.translation.value = false;
    await state.start();
    expect(api.align.mock.calls[0][0].lines[0].translation).toBe("");
    state.translation.value = true;
    expect(state.canApply.value).toBe(false);
    expect(state.results.value).toEqual([]);
  });
  it("整曲只有部分翻译候选时，区分检查行数、匹配行数和已保留的音译", async () => {
    const original = media.parsedLyric[0];
    media.parsedLyric = Array.from({ length: 35 }, () => ({
      ...original,
      romanizationWords: [
        { word: "kimi ", startTime: 1000, endTime: 1500 },
        { word: "to", startTime: 1500, endTime: 2000 },
      ],
    }));
    api.align.mockResolvedValueOnce({
      status: "completed",
      lines: Array.from({ length: 5 }, (_, id) => ({
        id,
        translation: {
          score: 1,
          parts: [
            { text: "与", from: 0, to: 0 },
            { text: "你", from: 1, to: 1 },
          ],
        },
      })),
    });
    const state = setup();
    await state.start();
    expect(api.align.mock.calls[0][0].lines).toHaveLength(35);
    expect(state.rows.value).toHaveLength(35);
    expect(state.results.value).toHaveLength(5);
    expect(state.coverage.value).toEqual([
      { field: "translation", total: 35, existing: 0, matched: 5 },
      { field: "romanization", total: 0, existing: 35, matched: 0 },
    ]);
    expect(state.selected.value.size).toBe(5);
    expect(state.apply()).toEqual({ count: 5, translation: true, romanization: false });
    expect(state.canApply.value).toBe(false);
  });
  it("翻译模型不可用时，音译仍可单独应用", async () => {
    api.align.mockResolvedValueOnce({ ...response, translationError: "模型加载失败" });
    const state = setup();
    await state.start();
    expect(state.translationError.value).toContain("模型加载失败");
    expect(state.canApply.value).toBe(true);
  });
  it("卸载立即取消任务，错误返回不会写入歌词", async () => {
    api.align.mockResolvedValueOnce({ status: "error", error: "failed" });
    const state = setup();
    await state.start();
    await flushPromises();
    expect(state.error.value).toBe("failed");
    expect(state.apply()).toBeNull();
  });
});
