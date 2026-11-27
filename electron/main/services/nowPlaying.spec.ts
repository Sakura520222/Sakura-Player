import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

vi.mock("@main/store", () => ({ store: { get: () => ({}) } }));

describe("交接后的歌词窗口锚点", () => {
  beforeEach(() => vi.resetModules());

  it("等新曲歌词到达再采用引擎锚点，后续歌词更新不覆盖新进度", async () => {
    const service = await import("./nowPlaying");
    service.update({ id: "old" } as Track, [], null);
    service.prepareTransition({ id: "next" } as Track, {
      position: 2400,
      state: "playing",
      speed: 1.5,
      timestamp: 12345,
    });
    expect(service.snapshot().track?.id).toBe("old");
    service.update({ id: "next" } as Track, [], null);
    expect(service.snapshot()).toMatchObject({
      position: 2400,
      speed: 1.5,
      sendTimestamp: 12345,
      playing: true,
    });
    service.onPosition(3000, true);
    service.update({ id: "next" } as Track, [], null);
    expect(service.snapshot().position).toBe(3000);
  });

  it("同 ID 切换服务端版本会换曲，修改标题和时长只刷新元数据", async () => {
    const service = await import("./nowPlaying");
    const track: Track = {
      id: "same-id",
      source: "streaming",
      serverId: "a",
      originalId: "42",
      serverRevision: 1,
      artists: [],
      title: "First",
      duration: 90000,
    };
    const changed = vi.fn();
    service.onTrackChange(changed);
    service.update(track, [], null);
    service.onPlayStateChange("paused", 67000);
    service.update({ ...track, title: "Tagged", duration: 90050 }, [], null);
    expect(service.snapshot().position).toBe(67000);
    expect(changed).toHaveBeenCalledTimes(1);
    service.update({ ...track, serverRevision: 2 }, [], null);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(service.snapshot().position).toBe(0);
    service.clear();
    expect(changed).toHaveBeenLastCalledWith({ track: null });
    service.update(track, [], null);
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it("不同来源的同 ID 交接只允许目标歌曲消费锚点", async () => {
    const service = await import("./nowPlaying");
    const old: Track = { id: "123", source: "netease", title: "old", artists: [], duration: 10000 };
    const next: Track = { ...old, source: "qqmusic", title: "next" };
    service.update(old, [], null);
    service.onPosition(6000, true);
    service.prepareTransition(next, {
      position: 1800,
      state: "playing",
      speed: 1,
      timestamp: 1234,
    });
    service.update(old, [], null);
    expect(service.snapshot().position).toBe(6000);
    service.update(next, [], null);
    expect(service.snapshot().position).toBe(1800);
  });

  it("暂停时的跳转立即替换歌曲位置与歌词快照的锚点", async () => {
    const service = await import("./nowPlaying");
    service.update({ id: "current" } as Track, [], null);
    service.onPosition(3000, true);
    const listener = vi.fn();
    const unsubscribe = service.onPositionSync(listener);
    service.onPlayStateChange("paused", 28000);
    expect(service.snapshot()).toMatchObject({ position: 28000, playing: false });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ position: 28000, playing: false }),
    );
    unsubscribe();
  });

  it("暂停的交接不会把歌词窗口恢复为播放态", async () => {
    const service = await import("./nowPlaying");
    service.prepareTransition({ id: "next" } as Track, {
      position: 1700,
      state: "paused",
      speed: 1,
      timestamp: 12345,
    });
    service.update({ id: "next" } as Track, [], null);
    expect(service.snapshot()).toMatchObject({ position: 1700, playing: false, state: "paused" });
  });

  it("不连续事件会清除已放弃的交接锚点，暂停状态会同步更新待落地锚点", async () => {
    const service = await import("./nowPlaying");
    service.update({ id: "a" } as Track, [], null);
    service.prepareTransition({ id: "b" } as Track, {
      position: 2000,
      state: "playing",
      speed: 1,
      timestamp: 1000,
    });
    service.notifyDiscontinuity();
    service.update({ id: "b" } as Track, [], null);
    expect(service.snapshot().position).toBe(0);

    service.prepareTransition({ id: "c" } as Track, {
      position: 1200,
      state: "playing",
      speed: 1,
      timestamp: 2000,
    });
    service.onPlayStateChange("paused", 1500);
    service.update({ id: "c" } as Track, [], null);
    expect(service.snapshot()).toMatchObject({ position: 1500, playing: false, state: "paused" });
  });
});
