import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({
  neteaseCall: vi.fn(),
  songUrl: vi.fn(),
  songDownloadUrl: vi.fn(),
  songDetail: vi.fn(),
  resolveJfjtSong: vi.fn(),
}));

vi.mock("@/apis/netease", () => ({
  neteaseCall: mocks.neteaseCall,
  netease: {
    song_url: mocks.songUrl,
    song_download_url: mocks.songDownloadUrl,
    song_detail: mocks.songDetail,
  },
}));

import {
  jfjtLevelToAudioQuality,
  jfjtLevelToQualityLevel,
  mapQualityToJfjtLevel,
  resolveNeteaseDownloadUrl,
  resolveNeteaseUrl,
} from "./netease";

const sampleTrack: Track = {
  id: "186016",
  source: "netease",
  title: "晴天",
  artists: [{ id: "6452", name: "周杰伦" }],
  duration: 269000,
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window, {
    api: {
      apis: {
        resolveJfjtSong: mocks.resolveJfjtSong,
      },
    },
  });
});

describe("JFJT 音质档位映射与实际音质回填", () => {
  it("将五档音质映射到 JFJT 支持的档位，sq 明确降级为 standard", () => {
    expect(mapQualityToJfjtLevel("lq")).toBe("standard");
    expect(mapQualityToJfjtLevel("sq")).toBe("standard");
    expect(mapQualityToJfjtLevel("hq")).toBe("exhigh");
    expect(mapQualityToJfjtLevel("lossless")).toBe("lossless");
    expect(mapQualityToJfjtLevel("hi-res")).toBe("hires");
  });

  it("以接口返回的 data.level 为准反映实际音质，未知档位不虚报", () => {
    expect(jfjtLevelToQualityLevel("standard")).toBe("lq");
    expect(jfjtLevelToQualityLevel("higher")).toBe("sq");
    expect(jfjtLevelToQualityLevel("exhigh")).toBe("hq");
    expect(jfjtLevelToQualityLevel("lossless")).toBe("lossless");
    expect(jfjtLevelToQualityLevel("hires")).toBe("hi-res");
    expect(jfjtLevelToQualityLevel("jymaster")).toBe("hi-res");
    expect(jfjtLevelToQualityLevel(undefined)).toBeUndefined();

    expect(jfjtLevelToAudioQuality("standard")?.bitRate).toBe(128000);
    expect(jfjtLevelToAudioQuality("exhigh")?.bitRate).toBe(320000);
    expect(jfjtLevelToAudioQuality("lossless")?.codec).toBe("flac");
    expect(jfjtLevelToAudioQuality(undefined)).toBeUndefined();
  });
});

describe("NCM 播放解析：JFJT 优先与官方回落", () => {
  it("优先调用 JFJT 并保留来源、实际音质与可选元数据", async () => {
    mocks.resolveJfjtSong.mockResolvedValueOnce({
      ok: true,
      data: {
        url: "https://cdn.example.com/song.mp3",
        rawLevel: "标准音质",
        jfjtLevel: "standard",
        metadata: { name: "晴天" },
      },
    });

    const result = await resolveNeteaseUrl(sampleTrack, "sq");
    expect(mocks.resolveJfjtSong).toHaveBeenCalledExactlyOnceWith("186016", "standard");
    expect(mocks.neteaseCall).not.toHaveBeenCalled();
    expect(result).toEqual({
      available: true,
      url: "https://cdn.example.com/song.mp3",
      isTrial: false,
      source: "jfjt",
      actualLevel: "lq",
      actualQuality: {
        codec: "mp3",
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        bitRate: 128000,
      },
      rawLevel: "标准音质",
      metadata: { name: "晴天" },
    });
  });

  it("JFJT 超时、报错或返回无效 URL 时自动回落官方 NCM 解析", async () => {
    mocks.resolveJfjtSong.mockResolvedValueOnce({ ok: false, error: "timeout" });
    mocks.neteaseCall.mockResolvedValueOnce({
      data: [{ url: "https://official.music.126.net/song.flac", freeTrialInfo: null }],
    });

    const result = await resolveNeteaseUrl(sampleTrack, "lossless");
    expect(mocks.resolveJfjtSong).toHaveBeenCalledExactlyOnceWith("186016", "lossless");
    expect(mocks.neteaseCall).toHaveBeenCalledExactlyOnceWith(
      "song_url",
      { id: "186016", level: "lossless" },
      { notifyAuthFailure: false },
    );
    expect(result).toEqual({
      available: true,
      url: "https://official.music.126.net/song.flac",
      isTrial: false,
      source: "official",
    });
  });

  it("JFJT 失败且官方无权限时保留原有 VIP 错误分类", async () => {
    mocks.resolveJfjtSong.mockRejectedValueOnce(new Error("ipc failed"));
    mocks.neteaseCall.mockResolvedValueOnce({
      data: [{ url: null, fee: 1 }],
    });

    const result = await resolveNeteaseUrl(sampleTrack, "hq");
    expect(result).toEqual({
      available: false,
      errorCode: ErrorCode.NETEASE_VIP_REQUIRED,
    });
  });

  it("云盘私有曲目与显式 skipJfjt 时直接走官方 NCM 解析", async () => {
    mocks.neteaseCall.mockResolvedValue({
      data: [{ url: "https://official.music.126.net/cloud.mp3", freeTrialInfo: null }],
    });

    await resolveNeteaseUrl({ ...sampleTrack, cloud: true }, "hq");
    await resolveNeteaseUrl(sampleTrack, "hq", undefined, { skipJfjt: true });

    expect(mocks.resolveJfjtSong).not.toHaveBeenCalled();
    expect(mocks.neteaseCall).toHaveBeenCalledTimes(2);
  });
});

describe("NCM 下载解析：JFJT 优先与官方回落", () => {
  it("优先返回 JFJT 下载直链并保留体积与实际音质，未声明格式时不猜测", async () => {
    mocks.resolveJfjtSong.mockResolvedValueOnce({
      ok: true,
      data: {
        url: "https://cdn.example.com/dl/186016",
        rawLevel: "exhigh",
        jfjtLevel: "exhigh",
        size: 10485760,
      },
    });

    const res = await resolveNeteaseDownloadUrl(sampleTrack, "lossless", false);
    expect(mocks.resolveJfjtSong).toHaveBeenCalledExactlyOnceWith("186016", "lossless");
    expect(mocks.songDownloadUrl).not.toHaveBeenCalled();
    expect(mocks.songUrl).not.toHaveBeenCalled();
    expect(res).toEqual({
      url: "https://cdn.example.com/dl/186016",
      source: "jfjt",
      size: 10485760,
      actualLevel: "hq",
      actualQuality: {
        codec: "mp3",
        sampleRate: 44100,
        channels: 2,
        bitsPerSample: 16,
        bitRate: 320000,
      },
      rawLevel: "exhigh",
    });
    expect(res?.format).toBeUndefined();
  });

  it("JFJT 失败时按默认顺序回落官方下载接口与播放接口", async () => {
    mocks.resolveJfjtSong.mockResolvedValueOnce({ ok: false, error: "http_502" });
    mocks.songDownloadUrl.mockResolvedValueOnce({
      data: { url: "https://official/dl.flac", type: "flac", size: 32000000 },
    });

    const res = await resolveNeteaseDownloadUrl(sampleTrack, "lossless", false);
    expect(mocks.songDownloadUrl).toHaveBeenCalledExactlyOnceWith({
      id: "186016",
      level: "lossless",
    });
    expect(mocks.songUrl).not.toHaveBeenCalled();
    expect(res).toEqual({
      url: "https://official/dl.flac",
      source: "official",
      format: "flac",
      size: 32000000,
    });
  });

  it("模拟播放下载开启且 JFJT 失败时跳过官方下载接口，避免消耗每日下载次数", async () => {
    mocks.resolveJfjtSong.mockResolvedValueOnce({ ok: false, error: "timeout" });
    mocks.songUrl.mockResolvedValueOnce({
      data: [{ url: "https://official/play.mp3", type: "mp3", size: 8000000, freeTrialInfo: null }],
    });

    const res = await resolveNeteaseDownloadUrl(sampleTrack, "sq", true);
    expect(mocks.resolveJfjtSong).toHaveBeenCalledExactlyOnceWith("186016", "standard");
    expect(mocks.songDownloadUrl).not.toHaveBeenCalled();
    expect(mocks.songUrl).toHaveBeenCalledExactlyOnceWith({ id: "186016", level: "higher" });
    expect(res).toEqual({
      url: "https://official/play.mp3",
      source: "official",
      format: "mp3",
      size: 8000000,
    });
  });
});
