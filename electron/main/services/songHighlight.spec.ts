import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { normalizeHighlightSegments } from "@shared/utils/songHighlight";

const api = vi.hoisted(() => ({
  netease: vi.fn(),
  kugou: vi.fn(),
}));
vi.mock("@main/apis/netease", () => ({ callNetease: api.netease }));
vi.mock("@main/apis/kugou", () => ({ callKugou: api.kugou }));
vi.mock("@main/utils/logger", () => ({ coreLog: { warn: vi.fn() } }));

const hash = "b3a52a7a958bf0aed0ebfba2e9a818b7";
const track: Track = {
  id: "186016",
  source: "netease",
  title: "晴天",
  artists: [{ name: "周杰伦" }],
  album: { name: "叶惠美" },
  duration: 269000,
};

/**
 * 构造酷狗真实字段形状的毫秒高潮标注
 * @param id - 当前歌曲 Hash
 * @returns 平台原始响应
 */
const climax = (id = hash) => ({
  status: 1,
  data: [{ hash: id.toUpperCase(), start_time: "84170", end_time: "142170" }],
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  api.netease
    .mockReset()
    .mockResolvedValue({ status: 200, body: { code: 200, result: { songs: [] }, chorus: [] } });
  api.kugou.mockReset().mockResolvedValue({ code: 200, songs: [] });
});
afterEach(() => vi.useRealTimers());

describe("高潮毫秒时间轴", () => {
  it("保留真实毫秒精度，去重排序并截断越过歌尾的结束时间", () => {
    expect(
      normalizeHighlightSegments(
        [
          { startMs: "152916", endMs: "178690" },
          { startMs: "84170", endMs: "142170" },
          { startMs: 84170, endMs: 150000 },
          { startMs: 200000, endMs: 300000 },
        ],
        269000,
      ),
    ).toEqual([
      { startMs: 84170, endMs: 142170 },
      { startMs: 152916, endMs: 178690 },
      { startMs: 200000, endMs: 269000 },
    ]);
  });

  it("拒绝空值、非有限数、零值哨兵、倒置区间和超出时长的起点", () => {
    expect(
      normalizeHighlightSegments(
        [
          { startMs: null },
          { startMs: "" },
          { startMs: false },
          { startMs: -1 },
          { startMs: NaN },
          { startMs: Infinity },
          { startMs: 0, endMs: 0 },
          { startMs: 0 },
          { startMs: 200, endMs: 100 },
          { startMs: 200, endMs: "" },
          { startMs: 1000 },
          { startMs: 100, endMs: "bad" },
          { startMs: 500 },
          { startMs: 0, endMs: 100 },
        ],
        1000,
      ),
    ).toEqual([{ startMs: 0, endMs: 100 }, { startMs: 500 }]);
  });

  it("多段结果始终有界", () => {
    expect(
      normalizeHighlightSegments(
        Array.from({ length: 200 }, (_, i) => ({ startMs: i + 1 })),
        0,
      ),
    ).toHaveLength(16);
  });
});

describe("当前歌曲高潮查询", () => {
  it("网易原生 ID 直取并按响应 ID 选择标注，无需重复搜索", async () => {
    api.netease.mockResolvedValue({
      status: 200,
      body: {
        code: 200,
        chorus: [
          { id: 2058263032, startTime: 152916, endTime: 178690 },
          { id: 186016, startTime: 84498, endTime: 142301 },
        ],
      },
    });
    const { getSongHighlight } = await import("./songHighlight");
    expect(await getSongHighlight(track)).toEqual({
      ok: true,
      data: {
        platform: "netease",
        platformId: "186016",
        matched: false,
        segments: [{ startMs: 84498, endMs: 142301 }],
      },
    });
    expect(api.netease).toHaveBeenCalledExactlyOnceWith("song_chorus", { id: "186016" });
    expect(api.kugou).not.toHaveBeenCalled();
  });

  it("酷狗 Hash 不区分大小写，单个查询忽略其他歌曲标注", async () => {
    api.kugou.mockResolvedValue({
      status: 1,
      data: [{ hash: "0".repeat(32), start_time: "1000", end_time: "2000" }, ...climax().data],
    });
    const { getSongHighlight } = await import("./songHighlight");
    const result = await getSongHighlight({ ...track, source: "kugou", id: hash });
    expect(result).toMatchObject({
      ok: true,
      data: { platform: "kugou", matched: false, segments: [{ startMs: 84170, endMs: 142170 }] },
    });
    expect(api.netease).not.toHaveBeenCalled();
  });

  it("原平台失败后匹配另一个平台的相同版本，失败不会掩盖有效结果", async () => {
    api.netease.mockRejectedValue(new Error("offline"));
    api.kugou.mockImplementation(async (name) =>
      name === "search"
        ? { code: 200, songs: [{ hash, name: "晴天", artist: "周杰伦", duration: 269000 }] }
        : climax(),
    );
    const { getSongHighlight } = await import("./songHighlight");
    expect(await getSongHighlight(track)).toMatchObject({
      ok: true,
      data: { platform: "kugou", matched: true },
    });
    expect(api.kugou).toHaveBeenLastCalledWith("song_climax", { hash });
  });

  it("本地元数据匹配拒绝 Live、同名异歌手和时长不符的版本", async () => {
    api.kugou.mockImplementation(async (name) =>
      name === "search"
        ? {
            code: 200,
            songs: [
              { hash: "1".repeat(32), name: "晴天 (Live)", artist: "周杰伦", duration: 269000 },
              { hash: "2".repeat(32), name: "晴天", artist: "其他歌手", duration: 269000 },
              { hash: "3".repeat(32), name: "晴天", artist: "周杰伦", duration: 260000 },
              { hash, name: "晴天", artist: "周杰伦", album: "叶惠美", duration: 269000 },
            ],
          }
        : climax(),
    );
    const { getSongHighlight } = await import("./songHighlight");
    expect(await getSongHighlight({ ...track, source: "local", id: "local:file" })).toMatchObject({
      ok: true,
      data: { platformId: hash, matched: true },
    });
    expect(api.kugou).toHaveBeenLastCalledWith("song_climax", { hash });
  });

  it("没有可靠匹配或有效时间时返回无标注，失败后可重试", async () => {
    const { getSongHighlight } = await import("./songHighlight");
    expect(await getSongHighlight(track)).toEqual({ ok: true, data: null });
    api.netease.mockRejectedValueOnce(new Error("network"));
    expect(await getSongHighlight(track)).toMatchObject({ ok: false });
    api.netease.mockResolvedValue({
      status: 200,
      body: { code: 200, chorus: [{ id: 186016, startTime: 1000, endTime: 2000 }] },
    });
    expect(await getSongHighlight(track)).toMatchObject({
      ok: true,
      data: { platform: "netease" },
    });
  });

  it("并发请求共用同一任务，正缓存过期后重新查询", async () => {
    vi.useFakeTimers();
    api.kugou.mockResolvedValue(climax());
    const { getSongHighlight } = await import("./songHighlight");
    const kg = { ...track, source: "kugou" as const, id: hash };
    const first = getSongHighlight(kg);
    expect(getSongHighlight(kg)).toBe(first);
    await first;
    await getSongHighlight(kg);
    expect(api.kugou).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    await getSongHighlight(kg);
    expect(api.kugou).toHaveBeenCalledTimes(2);
  });

  it("缓存容量有上限，最近使用项保留，旧项按需重新获取", async () => {
    api.kugou.mockImplementation(async (_name, params) => climax(params.hash));
    const { getSongHighlight } = await import("./songHighlight");
    for (let i = 0; i < 200; i++)
      await getSongHighlight({ ...track, source: "kugou", id: i.toString(16).padStart(32, "0") });
    await getSongHighlight({ ...track, source: "kugou", id: "0".repeat(32) });
    await getSongHighlight({ ...track, source: "kugou", id: "f".repeat(32) });
    await getSongHighlight({ ...track, source: "kugou", id: "0".repeat(32) });
    expect(api.kugou).toHaveBeenCalledTimes(201);
    await getSongHighlight({ ...track, source: "kugou", id: "1".padStart(32, "0") });
    expect(api.kugou).toHaveBeenCalledTimes(202);
  });

  it("快速切歌的在途请求有界，任务结束后释放名额", async () => {
    const releases: (() => void)[] = [];
    api.kugou.mockImplementation(
      (_name, params) =>
        new Promise((resolve) => releases.push(() => resolve(climax(params.hash)))),
    );
    const { getSongHighlight } = await import("./songHighlight");
    const pending = Array.from({ length: 8 }, (_, i) =>
      getSongHighlight({ ...track, source: "kugou", id: i.toString(16).padStart(32, "0") }),
    );
    expect(await getSongHighlight({ ...track, source: "kugou", id: hash })).toMatchObject({
      ok: false,
    });
    await vi.waitFor(() => expect(releases).toHaveLength(8));
    releases.forEach((release) => release());
    await Promise.all(pending);
    api.kugou.mockResolvedValue(climax());
    expect(await getSongHighlight({ ...track, source: "kugou", id: hash })).toMatchObject({
      ok: true,
      data: { platform: "kugou" },
    });
  });

  it("流媒体服务器和身份代次隔离缓存，插件源不进行平台匹配", async () => {
    api.kugou.mockImplementation(async (name) =>
      name === "search"
        ? { code: 200, songs: [{ hash, name: "晴天", artist: "周杰伦", duration: 269000 }] }
        : climax(),
    );
    const { getSongHighlight } = await import("./songHighlight");
    const streamed = { ...track, source: "streaming" as const, serverId: "a", serverRevision: 1 };
    await getSongHighlight(streamed);
    await getSongHighlight({ ...streamed, serverId: "b" });
    await getSongHighlight({ ...streamed, serverRevision: 2 });
    expect(api.kugou).toHaveBeenCalledTimes(6);
    expect(await getSongHighlight({ ...track, source: "plugin" })).toEqual({
      ok: true,
      data: null,
    });
    expect(api.kugou).toHaveBeenCalledTimes(6);
  });
});
