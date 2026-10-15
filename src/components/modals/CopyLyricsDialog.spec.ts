import { mount } from "@vue/test-utils";
import { reactive, defineComponent } from "vue";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import zh from "@/i18n/locales/zh-CN.json";
import type { Track } from "@shared/types/player";
import type { LyricLine, LyricInput, LyricFormat } from "@shared/types/lyrics";
import { LYRIC_SAVE_FIXTURES } from "@shared/testFixtures/lyricSave";
import { parseLyric } from "lyric-kit";

const mocks = vi.hoisted(() => ({
  saveFiles: vi.fn(),
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
        SDialog: { template: "<div><slot/><slot name='footer'/></div>" },
        SCheckbox: checkbox,
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
    lyricLoading: false,
    lyricFormat: "yrc",
    lyricContent: { content: "raw lyric" },
  });
  settings = reactive({ system: { localLyric: { enableLocalTTMLOverride: false, repoDir: "" } } });
  mocks.saveFiles
    .mockReset()
    .mockResolvedValue({ lrc: { status: "saved", path: "C:/Music/song.lrc" } });
  mocks.saveTrackTags.mockReset().mockResolvedValue([{ success: true }]);
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { lyrics: { saveFiles: mocks.saveFiles } },
  });
});

describe("复制歌词弹窗保存功能", () => {
  it.each(LYRIC_SAVE_FIXTURES)("$format 音乐标签保存原文，LRC 独立导出", async (input) => {
    media.lyricFormat = input.format;
    media.lyricContent = input;
    media.parsedLyric = parseLyric(input).lines;
    const wrapper = mountDialog();
    const lrc = wrapper
      .findAll("label")
      .find((label) => label.text() === "LRC 文件")!
      .find("input");
    expect((lrc.element as HTMLInputElement).checked).toBe(false);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "保存歌词")!
      .trigger("click");
    await vi.waitFor(() => expect(mocks.saveTrackTags).toHaveBeenCalledOnce());
    const { content, ...lyricData } = input;
    expect(mocks.saveTrackTags).toHaveBeenCalledWith([
      { path: media.track.path, lyrics: content, lyricData },
    ]);
    expect(mocks.saveFiles).not.toHaveBeenCalled();
    await lrc.setValue(true);
    mocks.saveTrackTags.mockClear();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "保存歌词")!
      .trigger("click");
    await vi.waitFor(() => expect(mocks.saveTrackTags).toHaveBeenCalledOnce());
    expect(mocks.saveFiles).toHaveBeenCalledOnce();
    const exported = mocks.saveFiles.mock.calls[0][0].lrc;
    expect(parseLyric({ format: "lrc", content: exported }).lines.length).toBeGreaterThan(0);
    expect(mocks.saveTrackTags.mock.calls[0][0][0].lyrics).toBe(content);
    wrapper.unmount();
  });

  it("取消行勾选后仍保存全部歌词，先保存文件再写入标签", async () => {
    const wrapper = mountDialog();
    await wrapper
      .findAll("label")
      .find((label) => label.text() === "LRC 文件")!
      .find("input")
      .setValue(true);
    await wrapper.setProps({ open: true });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "全不选")!
      .trigger("click");
    expect(wrapper.text()).toContain("已选 0 行");
    const save = wrapper.findAll("button").find((button) => button.text() === "保存歌词")!;
    await save.trigger("click");
    await vi.waitFor(() => expect(mocks.saveTrackTags).toHaveBeenCalledOnce());
    const request = mocks.saveFiles.mock.calls[0][0];
    expect(request.lrc).toContain("[00:00.000]歌词0");
    expect(request.lrc).toContain("[00:01.000]歌词1");
    expect(request.lrc).toContain("翻译");
    expect(request.lrc).toContain("romaji");
    expect(request.ttml).toBeUndefined();
    expect(mocks.saveTrackTags).toHaveBeenCalledWith([
      { path: media.track.path, lyrics: "raw lyric", lyricData: { format: "yrc" } },
    ]);
    expect(mocks.saveFiles.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveTrackTags.mock.invocationCallOrder[0],
    );
    wrapper.unmount();
  });

  it("只保存 TTML 时按钮可用，保留完整内容并补充匹配字段", async () => {
    settings.system.localLyric = { enableLocalTTMLOverride: true, repoDir: "C:/Lyrics" };
    media.lyricFormat = "ttml";
    media.lyricContent = {
      content: `<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="1s">完整歌词</p></div></body></tt>`,
    };
    const wrapper = mountDialog();
    const metadata = wrapper.findAll("label").find((label) => label.text() === "音乐标签")!;
    const lrc = wrapper.findAll("label").find((label) => label.text() === "LRC 文件")!;
    await metadata.find("input").setValue(false);
    await lrc.find("input").setValue(false);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "保存歌词")!
      .trigger("click");
    await vi.waitFor(() => expect(mocks.saveFiles).toHaveBeenCalledOnce());
    const request = mocks.saveFiles.mock.calls[0][0];
    expect(request.lrc).toBeUndefined();
    expect(request.ttml).toContain("完整歌词");
    expect(request.ttml).toContain('key="musicName" value="歌曲"');
    expect(mocks.saveTrackTags).not.toHaveBeenCalled();
    await wrapper
      .findAll("label")
      .find((label) => label.text() === "TTML 文件")!
      .find("input")
      .setValue(false);
    const save = wrapper.findAll("button").find((button) => button.text() === "保存歌词")!;
    await vi.waitFor(() => expect(save.attributes("disabled")).toBeDefined());
    wrapper.unmount();
  });

  it("取消 TTML 勾选后仅保存 LRC 和音乐标签", async () => {
    settings.system.localLyric = { enableLocalTTMLOverride: true, repoDir: "C:/Lyrics" };
    media.lyricFormat = "ttml";
    const wrapper = mountDialog();
    await wrapper
      .findAll("label")
      .find((label) => label.text() === "LRC 文件")!
      .find("input")
      .setValue(true);
    await wrapper
      .findAll("label")
      .find((label) => label.text() === "TTML 文件")!
      .find("input")
      .setValue(false);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "保存歌词")!
      .trigger("click");
    await vi.waitFor(() => expect(mocks.saveFiles).toHaveBeenCalledOnce());
    expect(mocks.saveFiles.mock.calls[0][0].ttml).toBeUndefined();
    expect(mocks.saveTrackTags).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it.each(["online", "cue"])("%s 歌曲禁用音乐标签，仅保存歌词文件", async (source) => {
    if (source === "online") media.track.source = "netease";
    else media.track.cuePath = "C:/Music/album.cue";
    const wrapper = mountDialog();
    const input = wrapper
      .findAll("label")
      .find((label) => label.text() === "音乐标签")!
      .find("input");
    expect(input.attributes("disabled")).toBeDefined();
    expect((input.element as HTMLInputElement).checked).toBe(false);
    const save = wrapper.findAll("button").find((button) => button.text() === "保存歌词")!;
    expect(save.attributes("disabled")).toBeDefined();
    await wrapper
      .findAll("label")
      .find((label) => label.text() === "LRC 文件")!
      .find("input")
      .setValue(true);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "保存歌词")!
      .trigger("click");
    await vi.waitFor(() => expect(mocks.saveFiles).toHaveBeenCalledOnce());
    expect(mocks.saveTrackTags).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("文件保存失败时继续写入音乐标签，并分别报告成功和失败", async () => {
    mocks.saveFiles.mockRejectedValue(new Error("IPC failed"));
    const wrapper = mountDialog();
    await wrapper
      .findAll("label")
      .find((label) => label.text() === "LRC 文件")!
      .find("input")
      .setValue(true);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "保存歌词")!
      .trigger("click");
    await vi.waitFor(() => expect(mocks.saveTrackTags).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledWith("已保存：音乐标签"));
    expect(mocks.error).toHaveBeenCalledWith("歌词文件保存失败");
    wrapper.unmount();
  });
});
