import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QualityControl from "./QualityControl.vue";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import type { AudioOutputMode } from "@shared/types/settings";

const mocks = vi.hoisted(() => ({
  isWin: true,
  isPlayerExpanded: true,
  audio: { audioOutputMode: "shared" as AudioOutputMode },
  player: { songLevel: "hq" },
  track: {
    source: "local",
    quality: { sampleRate: 44100, channels: 2, bitsPerSample: 16, bitRate: 1411200, codec: "flac" },
  },
  confirm: vi.fn(),
  setSystem: vi.fn(),
  reloadCurrentTrack: vi.fn(),
}));

vi.mock("@/utils/config", () => ({
  get isWin() {
    return mocks.isWin;
  },
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({
    player: mocks.player,
    system: { player: mocks.audio },
    setSystem: mocks.setSystem,
  }),
}));
vi.mock("@/stores/status", () => ({
  useStatusStore: () => ({ isPlayerExpanded: mocks.isPlayerExpanded }),
}));
vi.mock("@/stores/media", () => ({ useMediaStore: () => ({ track: mocks.track }) }));
vi.mock("@/composables/useDialog", () => ({ dialog: { confirm: mocks.confirm } }));
vi.mock("@/core/player", () => ({ reloadCurrentTrack: mocks.reloadCurrentTrack }));

/**
 * 挂载音质徽标及其菜单替身
 * @param cover - 是否属于全屏播放栏
 */
const mountQualityControl = (cover = true) =>
  mount(QualityControl, {
    props: { cover },
    global: {
      plugins: [
        createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
      ],
      stubs: {
        SDropdownMenu: {
          name: "SDropdownMenu",
          props: ["items", "cover"],
          emits: ["select", "update:open"],
          template: '<div><slot name="trigger" /></div>',
        },
        SPopselect: true,
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isWin = true;
  mocks.isPlayerExpanded = true;
  mocks.audio.audioOutputMode = "shared";
  mocks.track.source = "local";
  mocks.player.songLevel = "hq";
});

describe("播放栏音频输出快捷菜单", () => {
  it("普通播放栏提供同样的输出模式，并使用普通菜单样式", async () => {
    mocks.isPlayerExpanded = false;
    mocks.audio.audioOutputMode = "exclusive";
    const control = mountQualityControl(false);
    const menu = control.getComponent({ name: "SDropdownMenu" });
    expect(control.get("[data-audio-output-mode-trigger]").text()).toBe("Lossless");
    expect(menu.props("cover")).toBe(false);
    menu.vm.$emit("select", "shared");
    await flushPromises();
    expect(mocks.setSystem).toHaveBeenCalledExactlyOnceWith("player.audioOutputMode", "shared");
    control.unmount();
  });
  it("进入独占直通前确认，取消不写入设置", async () => {
    const control = mountQualityControl();
    const menu = control.getComponent({ name: "SDropdownMenu" });
    expect((menu.props("items") as DropdownMenuItem[]).map(({ key }) => key)).toEqual([
      "shared",
      "exclusive",
      "bit-perfect",
    ]);
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    menu.vm.$emit("select", "bit-perfect");
    await flushPromises();
    expect(mocks.setSystem).not.toHaveBeenCalled();
    menu.vm.$emit("select", "bit-perfect");
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.setSystem).toHaveBeenCalledExactlyOnceWith(
      "player.audioOutputMode",
      "bit-perfect",
    );
    control.unmount();
  });

  it("回到共享模式时直接写入设置，在线音质仍可从子菜单选择", async () => {
    mocks.audio.audioOutputMode = "exclusive";
    mocks.track.source = "netease";
    const control = mountQualityControl();
    const menu = control.getComponent({ name: "SDropdownMenu" });
    expect(
      (menu.props("items") as DropdownMenuItem[]).at(-1)?.children?.map(({ key }) => key),
    ).toContain("sq");
    menu.vm.$emit("select", "shared");
    await flushPromises();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.setSystem).toHaveBeenCalledExactlyOnceWith("player.audioOutputMode", "shared");
    menu.vm.$emit("select", "sq");
    expect(mocks.player.songLevel).toBe("sq");
    expect(mocks.reloadCurrentTrack).toHaveBeenCalledOnce();
    control.unmount();
  });

  it("非 Windows 的本地音质仍按普通徽标呈现", () => {
    mocks.isWin = false;
    const control = mountQualityControl();
    expect(control.find("[data-audio-output-mode-trigger]").exists()).toBe(false);
    expect(control.text()).toContain("Lossless");
    control.unmount();
  });
});
