import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { defaultSystemConfig } from "@shared/defaults/settings";
import * as playing from "@main/services/nowPlaying";
import { disposeCompanion, syncCompanionConfig, toggleDesktopPet } from "./index";

const mocks = vi.hoisted(() => ({
  generate: vi.fn<typeof import("@main/services/ai/companion").runCompanionAgent>(),
  lookup: vi.fn<typeof import("@main/services/songHighlight").getSongHighlight>(),
  broadcast: vi.fn(),
  syncWindow: vi.fn(),
  settings: { enabled: true, proactive: true, showAvatar: true },
}));
vi.mock("electron", () => ({
  app: { once: vi.fn() },
  ipcMain: {},
}));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => {
      if (key === "companion") return { ...defaultSystemConfig.companion, ...mocks.settings };
      if (key === "companion.proactive") return mocks.settings.proactive;
      return undefined;
    },
    set: (key: string, value: Record<string, unknown>) => {
      if (key === "companion") {
        mocks.settings = {
          enabled: Boolean(value.enabled),
          proactive: Boolean(value.proactive),
          showAvatar: Boolean(value.showAvatar),
        };
      }
    },
  },
}));
vi.mock("@main/window", () => ({ getMainWindow: () => null }));
vi.mock("@main/window/companion", () => ({
  getCompanionWindow: () => null,
  syncCompanionWindow: mocks.syncWindow,
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: mocks.broadcast, sendToMain: vi.fn() }));
vi.mock("@main/services/songHighlight", () => ({ getSongHighlight: mocks.lookup }));
vi.mock("@main/services/ai/companion", () => ({ runCompanionAgent: mocks.generate }));

const song: Track = { id: "a", source: "netease", title: "甲", duration: 200_000, artists: [] };
let start = 0;

/**
 * 推送指定时刻的播放位置并等待该帧发起的异步工作
 * @param ms - 自场景开始经过的毫秒数
 * @param position - 当前曲目内的毫秒位置
 */
async function advance(ms: number, position = ms) {
  vi.setSystemTime(start + ms);
  playing.onPosition(position, true);
  await vi.dynamicImportSettled();
}

describe("陪伴服务的播放事件与标注查询", () => {
  beforeEach(() => {
    start += 1_000_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    mocks.settings = { enabled: true, proactive: true, showAvatar: true };
    mocks.generate.mockResolvedValue({ text: "回应", usage: null });
    mocks.lookup.mockImplementation(async () => ({
      ok: true,
      sources: [],
      data: {
        segments: [
          {
            kind: "chorus",
            platform: "netease",
            platformId: "a",
            confidence: "exact-id",
            startMs: 28_000,
            endMs: 150_000,
          },
        ],
      },
    }));
    playing.update(song, [], null);
    syncCompanionConfig();
  });
  afterEach(() => {
    disposeCompanion();
    playing.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("更新专辑标签后重新匹配标注，同一播放轮次不再介绍歌曲或重复已听段落", async () => {
    await advance(0);
    await advance(6000);
    await advance(40_000);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    playing.update({ ...song, album: { id: "album", name: "补齐的专辑" } }, [], null);
    await advance(41_000);
    await advance(80_000);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it("跨曲冷却期照常查询新曲标注，冷却结束时能识别已进入的副歌", async () => {
    await advance(0);
    await advance(6000);
    playing.update({ ...song, id: "b", title: "乙" }, [], null);
    await advance(7000, 0);
    await advance(13_000, 6000);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    await advance(36_000, 29_000);
    expect(mocks.generate.mock.lastCall?.[0].prompt).toContain("副歌");
  });

  it("长耗时回复实际显示后才开始发言冷却", async () => {
    const response = Promise.withResolvers<{ text: string; usage: null }>();
    mocks.generate.mockReturnValueOnce(response.promise);
    await advance(0);
    await advance(6000);
    vi.setSystemTime(start + 40_000);
    response.resolve({ text: "迟到的回应", usage: null });
    await vi.dynamicImportSettled();
    await advance(41_000);
    expect(mocks.generate).toHaveBeenCalledOnce();
    await advance(70_000);
    expect(mocks.generate.mock.lastCall?.[0].prompt).toContain("副歌");
  });

  it("切换桌面宠物时未启用陪伴会一并开启，关闭时仅隐藏角色并广播配置变更", () => {
    mocks.settings = { enabled: false, proactive: false, showAvatar: true };
    mocks.broadcast.mockClear();
    mocks.syncWindow.mockClear();

    expect(toggleDesktopPet()).toBe(true);
    expect(mocks.settings).toMatchObject({ enabled: true, showAvatar: true });
    expect(mocks.syncWindow).toHaveBeenCalledOnce();
    expect(mocks.broadcast).toHaveBeenLastCalledWith(
      "companion:configChange",
      expect.objectContaining({ enabled: true, showAvatar: true }),
    );

    expect(toggleDesktopPet()).toBe(false);
    expect(mocks.settings).toMatchObject({ enabled: true, showAvatar: false });
    expect(mocks.broadcast).toHaveBeenLastCalledWith(
      "companion:configChange",
      expect.objectContaining({ enabled: true, showAvatar: false }),
    );

    expect(toggleDesktopPet()).toBe(true);
    expect(mocks.settings).toMatchObject({ enabled: true, showAvatar: true });
  });
});
