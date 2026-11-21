import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { expect, it, vi } from "vitest";
import PlayerBackground from "./PlayerBackground.vue";

const media = reactive({ track: { cover: "/cover-a.png" } });

vi.mock("@/stores/media", () => ({ useMediaStore: () => media }));
vi.mock("@/stores/status", () => ({
  useStatusStore: () => ({ isPlayerExpanded: true, isPlaying: false }),
}));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ player: { playerBgType: "blur" } }),
}));

it("切回正在显示的歌曲时忽略上一首尚未解码的背景", async () => {
  const decode = Promise.withResolvers<void>();
  vi.stubGlobal(
    "Image",
    class {
      /** 延迟背景解码以模拟快速切回正在显示的歌曲 */
      decode(): Promise<void> {
        return decode.promise;
      }
    },
  );
  const wrapper = mount(PlayerBackground, {
    props: { active: false, visible: true, suspended: false },
  });
  try {
    media.track = { cover: "/cover-b.png" };
    await flushPromises();
    media.track = { cover: "/cover-a.png" };
    await flushPromises();
    decode.resolve();
    await flushPromises();
    expect(wrapper.get(".bg-img.active").attributes("src")).toBe("/cover-a.png");
    expect(wrapper.find('img[src="/cover-b.png"]').exists()).toBe(false);
  } finally {
    wrapper.unmount();
    vi.unstubAllGlobals();
  }
});
