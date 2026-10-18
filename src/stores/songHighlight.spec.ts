import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createPinia, disposePinia, getActivePinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import type { SongHighlightResponse } from "@shared/types/songHighlight";
import zhCN from "@/i18n/locales/zh-CN.json";

const state = vi.hoisted(() => ({
  media: { track: null as Track | null },
  status: { position: 0, duration: 269000, trackLoading: false },
  settings: { player: { showSongHighlight: true, showProgressTooltip: true } },
  fetch: vi.fn(),
  seek: vi.fn(),
  snap: vi.fn((value: number) => value + 50),
}));
vi.mock("@/stores/media", async () => {
  const { shallowReactive } = await import("vue");
  return { useMediaStore: () => shallowReactive(state.media) };
});
vi.mock("@/stores/status", async () => {
  const { shallowReactive } = await import("vue");
  return { useStatusStore: () => shallowReactive(state.status) };
});
vi.mock("@/stores/settings", async () => {
  const { reactive } = await import("vue");
  return { useSettingsStore: () => reactive(state.settings) };
});
vi.mock("@/core/player", () => ({ seek: state.seek }));
vi.mock("@/composables/useProgressLyric", () => ({
  useProgressLyric: () => ({ formatTooltip: String, snapToNearestLyric: state.snap }),
}));

import { useSongHighlightStore } from "./songHighlight";
import { useMediaStore } from "./media";
import { useStatusStore } from "./status";
import { useSettingsStore } from "./settings";
import PlayerProgress from "@/components/player/PlayerProgress.vue";
import SongHighlightButton from "@/components/player/SongHighlightButton.vue";

const track: Track = {
  id: "first",
  source: "local",
  title: "晴天",
  artists: [{ name: "周杰伦" }],
  duration: 269000,
};
const result: SongHighlightResponse = {
  ok: true,
  data: {
    platform: "kugou",
    platformId: "b3a52a7a958bf0aed0ebfba2e9a818b7",
    matched: true,
    segments: [{ startMs: 84170, endMs: 142170 }],
  },
};
const wrappers: VueWrapper[] = [];

/**
 * 为不同布局挂载共享高潮控件
 * @param component - 按钮或进度条组件
 * @returns 已挂载的控件
 */
const mountControl = (component: typeof PlayerProgress | typeof SongHighlightButton) => {
  const wrapper = mount(component, {
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zhCN } })],
      stubs: {
        SSlider: {
          name: "SSlider",
          props: ["cover", "thumbSize"],
          template: "<div class='slider' />",
        },
        SButton: {
          props: ["disabled", "loading"],
          template: '<button :disabled="disabled || loading"><slot name="icon" /></button>',
        },
        IconLucideFlame: true,
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
};

beforeEach(() => {
  setActivePinia(createPinia());
  useMediaStore().track = { ...track };
  Object.assign(useStatusStore(), { position: 0, duration: 269000, trackLoading: false });
  useSettingsStore().player.showSongHighlight = true;
  state.fetch.mockReset().mockResolvedValue(result);
  state.seek.mockReset().mockResolvedValue(undefined);
  state.snap.mockClear();
  Object.assign(window, { api: { apis: { getSongHighlight: state.fetch } } });
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  const pinia = getActivePinia();
  if (pinia) disposePinia(pinia);
});

describe("当前歌曲高潮状态", () => {
  it("所有播放布局共用一次请求，仅显示高潮区间并保留按钮跳转", async () => {
    const regular = mountControl(PlayerProgress);
    const full = mountControl(PlayerProgress);
    const button = mountControl(SongHighlightButton);
    await flushPromises();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(regular.find("button").exists()).toBe(false);
    expect(full.find("button").exists()).toBe(false);
    expect(regular.find("span").exists()).toBe(true);
    expect(full.find("span").exists()).toBe(true);
    expect(regular.get("span").attributes("title")).toBeUndefined();
    regular.getComponent({ name: "SSlider" }).vm.$emit("dragEnd", 80000);
    expect(state.seek).toHaveBeenLastCalledWith(80050);
    expect(button.get("button").attributes("title")).toBeUndefined();
    expect(button.get("button").attributes("aria-label")).toContain("1:24");
    expect(button.get("button").attributes("aria-label")).toContain("酷狗");
    await button.get("button").trigger("click");
    expect(state.seek).toHaveBeenLastCalledWith(84170);
  });

  it("快速切歌立即清空标注，旧歌曲响应不覆盖新歌曲", async () => {
    let resolveOld!: (value: SongHighlightResponse) => void;
    state.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const store = useSongHighlightStore();
    useMediaStore().track = { ...track, id: "second", source: "netease" };
    expect(store.highlight).toBeNull();
    await flushPromises();
    expect(store.highlight?.platform).toBe("kugou");
    const current = store.highlight;
    resolveOld({ ok: true, data: { ...(result.ok && result.data!), platform: "netease" } });
    await flushPromises();
    expect(store.highlight).toBe(current);
    useStatusStore().trackLoading = true;
    expect(store.highlight).toBeNull();
    await store.seekToHighlight(84170);
    expect(state.seek).not.toHaveBeenCalled();
  });

  it("关闭功能立即取消结果应用且停止请求，重新启用可查询", async () => {
    let resolve!: (value: SongHighlightResponse) => void;
    state.fetch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const store = useSongHighlightStore();
    useSettingsStore().player.showSongHighlight = false;
    resolve(result);
    await flushPromises();
    expect(store.highlight).toBeNull();
    expect(store.phase).toBe("idle");
    useMediaStore().track = { ...track, id: "second" };
    expect(state.fetch).toHaveBeenCalledTimes(1);
    useSettingsStore().player.showSongHighlight = true;
    await flushPromises();
    expect(store.phase).toBe("ready");
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it("区分无标注和失败，按钮支持再次获取", async () => {
    state.fetch
      .mockResolvedValueOnce({ ok: true, data: null })
      .mockResolvedValueOnce({ ok: false, error: "offline" });
    const button = mountControl(SongHighlightButton);
    const store = useSongHighlightStore();
    await flushPromises();
    expect(store.phase).toBe("empty");
    await button.get("button").trigger("click");
    await flushPromises();
    expect(store.phase).toBe("error");
    expect(state.seek).not.toHaveBeenCalled();
    await button.get("button").trigger("click");
    await flushPromises();
    expect(store.phase).toBe("ready");
    expect(state.seek).toHaveBeenCalledWith(84170);
  });

  it("等待歌曲加载完成，元数据补全后再匹配且排除超出实际时长的标注", async () => {
    useStatusStore().trackLoading = true;
    const store = useSongHighlightStore();
    expect(state.fetch).not.toHaveBeenCalled();
    useMediaStore().track = { ...track, title: "补全后的标题" };
    useStatusStore().trackLoading = false;
    await flushPromises();
    expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "补全后的标题" }),
    );
    useStatusStore().duration = 80000;
    expect(store.segments).toEqual([]);
    await store.seekToHighlight();
    expect(state.seek).not.toHaveBeenCalled();
  });

  it("后续高潮按播放位置选择，插件源不会请求内置平台", async () => {
    state.fetch.mockResolvedValue({
      ok: true,
      data: {
        ...(result.ok && result.data!),
        segments: [
          { startMs: 1000, endMs: 2000 },
          { startMs: 3000, endMs: 4000 },
        ],
      },
    });
    const store = useSongHighlightStore();
    await flushPromises();
    useStatusStore().position = 1500;
    await store.seekToHighlight();
    expect(state.seek).toHaveBeenLastCalledWith(3000);
    useStatusStore().position = 5000;
    await store.seekToHighlight();
    expect(state.seek).toHaveBeenLastCalledWith(1000);
    useMediaStore().track = { ...track, source: "plugin" };
    expect(store.enabled).toBe(false);
    expect(store.highlight).toBeNull();
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
});
