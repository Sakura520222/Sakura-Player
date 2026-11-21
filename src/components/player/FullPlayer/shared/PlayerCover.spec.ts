import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlayerCover from "./PlayerCover.vue";

const media = reactive({ track: { id: "a", source: "local", cover: "cache://covers/a.jpg" } });
const status = reactive({ isPlayerExpanded: true, trackLoading: true, isPlaying: false });
const getCoverRaw = vi.fn();

vi.mock("@/stores/media", () => ({ useMediaStore: () => media }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => status }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ reducedMotion: false, player: { motionCoverSource: "off" } }),
}));

beforeEach(() => {
  media.track = { id: "a", source: "local", cover: "cache://covers/a.jpg" };
  status.trackLoading = true;
  getCoverRaw.mockReset().mockResolvedValue({ success: true, data: "cache://covers/b-full.jpg" });
  vi.stubGlobal("api", { player: { getCoverRaw } });
  vi.stubGlobal(
    "Image",
    class {
      /** 让测试自行控制交叉淡入的结束时机 */
      decode(): Promise<void> {
        return Promise.resolve();
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("全屏封面交叉淡入", () => {
  it.each([false, true])("高清图先到时保留正在淡入的缩略图，继续切歌：%s", async (skip) => {
    const wrapper = mount(PlayerCover, {
      global: {
        stubs: {
          DetailCover: { props: ["src"], template: '<div :data-cover-src="src" />' },
        },
      },
    });
    try {
      const sources = () =>
        wrapper.findAll("[data-cover-layer]").map((layer) => layer.attributes("data-cover-src"));
      media.track = {
        id: skip ? "b-before-skip" : "b",
        source: "local",
        cover: "cache://covers/b.jpg",
      };
      await flushPromises();
      expect(sources()).toEqual(["cache://covers/a.jpg", "cache://covers/b.jpg"]);
      const entering = wrapper.findAll("[data-cover-layer]")[1].element;

      status.trackLoading = false;
      await flushPromises();
      expect(getCoverRaw).toHaveBeenCalledOnce();
      expect(wrapper.findAll("[data-cover-layer]")[1].element).toBe(entering);
      expect(sources()).toEqual(["cache://covers/a.jpg", "cache://covers/b.jpg"]);

      if (skip) {
        status.trackLoading = true;
        media.track = { id: "c", source: "local", cover: "cache://covers/c.jpg" };
        await flushPromises();
      }
      const transition = wrapper.getComponent("transition-group-stub") as VueWrapper;
      transition.vm.$emit("after-enter", entering);
      await flushPromises();
      expect(sources()).toEqual([
        "cache://covers/b.jpg",
        skip ? "cache://covers/c.jpg" : "cache://covers/b-full.jpg",
      ]);
    } finally {
      wrapper.unmount();
    }
  });
});
