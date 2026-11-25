import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const mocks = vi.hoisted(() => ({
  resolveNeteaseDownloadUrl: vi.fn(),
  resolveQQMusicUrl: vi.fn(),
  resolveKugouUrl: vi.fn(),
  resolveByPlugin: vi.fn(),
}));

vi.mock("@/apis/song/netease", () => ({
  resolveNeteaseDownloadUrl: mocks.resolveNeteaseDownloadUrl,
}));
vi.mock("@/apis/song/qqmusic", () => ({
  resolveQQMusicUrl: mocks.resolveQQMusicUrl,
}));
vi.mock("@/apis/song/kugou", () => ({
  resolveKugouUrl: mocks.resolveKugouUrl,
}));
vi.mock("@/services/audioSource", () => ({
  resolveByPlugin: mocks.resolveByPlugin,
}));

import { resolveDownloadSource } from "./source";

const ncmTrack: Track = {
  id: "186016",
  source: "netease",
  title: "晴天",
  artists: [{ id: "6452", name: "周杰伦" }],
  duration: 269000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("下载源解析链路", () => {
  it("NCM 歌曲优先使用 JFJT/官方解析结果并透传体积与实际音质", async () => {
    mocks.resolveNeteaseDownloadUrl.mockResolvedValueOnce({
      url: "https://cdn.example.com/song.flac",
      source: "jfjt",
      size: 28000000,
      actualLevel: "lossless",
      actualQuality: {
        declaredLevel: "lossless",
        codec: "unknown",
        sampleRate: 0,
        channels: 0,
        bitsPerSample: 0,
        bitRate: 0,
      },
    });

    const source = await resolveDownloadSource(ncmTrack, "lossless", true);
    expect(mocks.resolveNeteaseDownloadUrl).toHaveBeenCalledExactlyOnceWith(
      ncmTrack,
      "lossless",
      true,
      false,
    );
    expect(mocks.resolveByPlugin).not.toHaveBeenCalled();
    expect(source?.url).toBe("https://cdn.example.com/song.flac");
    expect(source?.size).toBe(28000000);
    expect(source?.actualLevel).toBe("lossless");
  });

  it("NCM 解析无果时继续回落插件音源", async () => {
    mocks.resolveNeteaseDownloadUrl.mockResolvedValueOnce(null);
    mocks.resolveByPlugin.mockResolvedValueOnce({
      ok: true,
      url: "https://plugin.example.com/song.mp3",
      isTrial: false,
      provider: "plugin",
      pluginId: "demo",
    });

    const source = await resolveDownloadSource(ncmTrack, "hq", false);
    expect(source).toEqual({ url: "https://plugin.example.com/song.mp3" });
  });

  it("不影响 QM、KG 与流媒体的原有下载解析行为", async () => {
    mocks.resolveQQMusicUrl.mockResolvedValueOnce({
      available: true,
      url: "https://qm.example.com/song.flac",
      isTrial: false,
    });
    mocks.resolveKugouUrl.mockResolvedValueOnce({
      available: true,
      url: "https://kg.example.com/song.flac",
      isTrial: false,
    });

    expect(
      await resolveDownloadSource({ ...ncmTrack, source: "qqmusic", id: "001" }, "hq", false),
    ).toEqual({ url: "https://qm.example.com/song.flac" });
    expect(
      await resolveDownloadSource({ ...ncmTrack, source: "kugou", id: "hash1" }, "hq", false),
    ).toEqual({ url: "https://kg.example.com/song.flac" });
    expect(
      await resolveDownloadSource(
        { ...ncmTrack, source: "streaming", serverId: "srv", originalId: "orig" },
        "hq",
        false,
      ),
    ).toEqual({ url: "streaming://srv/orig" });
    expect(mocks.resolveNeteaseDownloadUrl).not.toHaveBeenCalled();
  });
});
