import { flushPromises, mount } from "@vue/test-utils";
import { reactive, defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zh from "@/i18n/locales/zh-CN.json";
import type { Track } from "@shared/types/player";
import type { LyricLine, LyricInput, LyricFormat } from "@shared/types/lyrics";
import { LYRIC_SAVE_FIXTURES } from "@shared/testFixtures/lyricSave";
import { parseLyric } from "lyric-kit";
import { parseExportTtml } from "@shared/utils/lyricTtml";
import type { LyricSavePreviewTarget } from "@/types/lyric-preview";

const mocks = vi.hoisted(() => ({
  saveFiles: vi.fn(),
  previewFiles: vi.fn(),
  readTags: vi.fn(),
  saveTrackTags: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
let media: {
  track: Track;
  parsedLyric: LyricLine[];
  lyricLoading: boolean;
  lyricFormat: LyricFormat;
  lyricContent: LyricInput | null;
  getLyricExportLines: () => LyricLine[];
};
let settings: { system: { localLyric: { enableLocalTTMLOverride: boolean; repoDir: string } } };
vi.mock("@/stores/media", () => ({ useMediaStore: () => media }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => settings }));
vi.mock("@/stores/theme", () => ({ useThemeStore: () => ({ coverColor: "#000" }) }));
vi.mock("@/core/player", () => ({ saveTrackTags: mocks.saveTrackTags }));
vi.mock("@/composables/useCopyText", () => ({ useCopyText: () => ({ copy: vi.fn() }) }));
vi.mock("@/composables/useToast", () => ({ toast: mocks }));
vi.mock("@/utils/lyric/poster", () => ({ createLyricPoster: vi.fn() }));
import CopyLyricsDialog from "./CopyLyricsDialog.vue";

const checkbox = defineComponent({
  props: { checked: Boolean, disabled: Boolean, label: String },
  emits: ["update:checked"],
  template: `<label><input type="checkbox" :checked="checked" :disabled="disabled" @change="$emit('update:checked', $event.target.checked)"/>{{ label }}<slot/></label>`,
});
const mountDialog = () =>
  mount(CopyLyricsDialog, {
    props: { open: false },
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zh } })],
      stubs: {
        LyricSavePreviewDialog: {
          name: "LyricSavePreviewDialog",
          props: ["open", "targets"],
          template: "<div data-testid='lyric-preview'/>",
        },
        SDialog: { template: "<div><slot/><slot name='footer'/></div>" },
        SCheckbox: checkbox,
        SSelect: true,
        SCheckboxGroup: { template: "<div><slot/></div>" },
        SButton: {
          props: ["disabled", "loading"],
          template: "<button :disabled='disabled || loading'><slot/></button>",
        },
      },
    },
  });

beforeEach(() => {
  media = reactive({
    track: {
      id: "1",
      source: "local",
      path: "C:/Music/song.flac",
      title: "歌曲",
      artists: [],
      duration: 30000,
    },
    parsedLyric: [0, 1].map((index) => ({
      startTime: index * 1000,
      endTime: index * 1000 + 1000,
      words: [{ word: `歌词${index}`, startTime: index * 1000, endTime: index * 1000 + 1000 }],
      translatedLyric: "翻译",
      romanLyric: "romaji",
      isBG: false,
      isDuet: false,
    })),
    getLyricExportLines: () => media.parsedLyric,
    lyricLoading: false,
    lyricFormat: "yrc",
    lyricContent: { content: "raw lyric" },
  });
  settings = reactive({ system: { localLyric: { enableLocalTTMLOverride: false, repoDir: "" } } });
  mocks.saveFiles
    .mockReset()
    .mockResolvedValue({ lrc: { status: "saved", path: "C:/Music/song.lrc" } });
  mocks.saveTrackTags.mockReset().mockResolvedValue([{ success: true }]);
  mocks.previewFiles.mockReset().mockResolvedValue({
    lrc: { status: "ready", content: "旧 LRC", path: "C:/Music/song.lrc", exists: true },
    ttml: { status: "ready", content: "旧 TTML", path: "C:/Lyrics/song.ttml", exists: true },
  });
  mocks.readTags.mockReset().mockResolvedValue({
    success: true,
    data: {
      lyrics: "旧歌词",
      hasCover: false,
      lyricData: { format: "lrc", translation: "旧翻译", romaji: "旧音译" },
    },
  });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      lyrics: { saveFiles: mocks.saveFiles, previewFiles: mocks.previewFiles },
      library: { readTags: mocks.readTags },
    },
  });
});

const label = (wrapper: ReturnType<typeof mountDialog>, name: string) =>
  wrapper
    .findAll("label")
    .find((item) => item.text() === name)!
    .find("input");

const click = async (wrapper: ReturnType<typeof mountDialog>, text: string) =>
  wrapper
    .findAll("button")
    .find((item) => item.text() === text)!
    .trigger("click");

const previewTargets = async (
  wrapper: ReturnType<typeof mountDialog>,
): Promise<LyricSavePreviewTarget[]> => {
  await vi.waitFor(() => expect(wrapper.find("[data-testid='lyric-preview']").exists()).toBe(true));
  return wrapper.getComponent({ name: "LyricSavePreviewDialog" }).props("targets");
};

describe("歌词保存弹窗", () => {
  it.each(LYRIC_SAVE_FIXTURES)("$format 默认预览完整 TTML，预览不写入文件", async (input) => {
    media.lyricContent = input;
    media.lyricFormat = input.format;
    media.parsedLyric = parseLyric(input).lines;
    const wrapper = mountDialog();
    await wrapper.setProps({ open: true });
    await click(wrapper, "预览更改");
    const targets = await previewTargets(wrapper);
    expect(targets.map(({ key }) => key)).toEqual(["ttml"]);
    expect(parseExportTtml(targets[0].fields[0].after).lines[0].romanLyric).toBe("zhu zi ge ci");
    expect(mocks.saveFiles).not.toHaveBeenCalled();
    expect(mocks.readTags).not.toHaveBeenCalled();
    await wrapper.setProps({ open: false });
    expect(wrapper.find("[data-testid='lyric-preview']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("预览和写入使用相同内容，兼容原文与翻译、音译分别保存", async () => {
    mocks.previewFiles.mockResolvedValue({
      lrc: { status: "ready", content: "旧 LRC" },
      ttml: { status: "ready", content: "旧 TTML" },
      translation: { status: "ready", content: "旧译文" },
      romanization: { status: "ready", content: "旧音译" },
    });
    settings.system.localLyric = { enableLocalTTMLOverride: true, repoDir: "C:/Lyrics" };
    const wrapper = mountDialog();
    await wrapper.setProps({ open: true });
    await label(wrapper, "兼容格式").setValue(true);
    await click(wrapper, "全不选");
    await click(wrapper, "预览更改");
    const targets = await previewTargets(wrapper);
    expect(targets.map(({ key }) => key)).toEqual(["lrc", "ttml", "translation", "romanization"]);
    const request = mocks.previewFiles.mock.calls[0][0];
    expect(request.saveTtmlAs).toBe(false);
    expect(request.lrc).toContain("[00:01.000]歌词1");
    expect(request.lrc).not.toContain("翻译");
    expect(request.translation).toContain("[00:01.000]翻译");
    expect(request.romanization).toContain("[00:01.000]romaji");
    await click(wrapper, "保存歌词");
    await vi.waitFor(() => expect(mocks.saveFiles).toHaveBeenCalledWith(request));
    wrapper.unmount();
  });

  it("切歌后丢弃晚到的标签预览，读取失败单独显示", async () => {
    let finish!: (value: unknown) => void;
    mocks.readTags.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mountDialog();
    await wrapper.setProps({ open: true });
    await label(wrapper, "嵌入 TTML 到音乐标签").setValue(true);
    await label(wrapper, "完整 TTML").setValue(false);
    await click(wrapper, "预览更改");
    media.track = { ...media.track, id: "next", path: "C:/Music/next.flac" };
    finish({ success: true, data: { lyrics: "上一首歌词" } });
    await flushPromises();
    expect(wrapper.find("[data-testid='lyric-preview']").exists()).toBe(false);
    mocks.readTags.mockResolvedValueOnce({ success: false });
    await click(wrapper, "预览更改");
    const targets = await previewTargets(wrapper);
    expect(targets[0].fields).toEqual([]);
    expect(targets[0].error).toBeTruthy();
    wrapper.unmount();
  });

  it("文件失败后仍独立嵌入完整歌词，并报告两项结果", async () => {
    mocks.saveFiles.mockRejectedValue(new Error("IPC failed"));
    const wrapper = mountDialog();
    await label(wrapper, "嵌入 TTML 到音乐标签").setValue(true);
    await click(wrapper, "保存歌词");
    await vi.waitFor(() => expect(mocks.saveTrackTags).toHaveBeenCalledOnce());
    const [tag] = mocks.saveTrackTags.mock.calls[0][0];
    expect(tag.lyricData.format).toBe("ttml");
    expect(parseExportTtml(tag.lyrics).lines[0].translatedLyric).toBe("翻译");
    expect(mocks.saveFiles.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveTrackTags.mock.invocationCallOrder[0],
    );
    expect(mocks.success).toHaveBeenCalledWith("已保存：嵌入 TTML 到音乐标签");
    expect(mocks.error).toHaveBeenCalledWith("歌词文件保存失败");
    wrapper.unmount();
  });

  it.each(["online", "cue"])("%s 可另存为 TTML，禁用音频标签", async (kind) => {
    if (kind === "online") media.track.source = "netease";
    else media.track.cuePath = "C:/Music/album.cue";
    const wrapper = mountDialog();
    expect(label(wrapper, "嵌入 TTML 到音乐标签").attributes("disabled")).toBeDefined();
    await click(wrapper, "保存歌词");
    await vi.waitFor(() =>
      expect(mocks.saveFiles).toHaveBeenCalledWith(expect.objectContaining({ saveTtmlAs: true })),
    );
    expect(mocks.saveTrackTags).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
