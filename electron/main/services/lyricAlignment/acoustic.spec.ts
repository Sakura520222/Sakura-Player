import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  release: vi.fn(),
  range: { source: "C:/music/test.flac", startMs: 10_000, endMs: 20_000, trackId: "song" },
  current: "song",
}));
vi.mock("../playerPreload", () => ({ getCurrentAudioRange: () => mocks.range }));
vi.mock("../nowPlaying", () => ({ lightSnapshot: () => ({ track: { id: mocks.current } }) }));
vi.mock("./environment", () => ({
  acquireAlignmentEnvironment: async () => ({ modelDirectory: "model", release: mocks.release }),
}));
vi.mock("./acousticRuntime", () => ({ acousticRuntimePath: () => "runtime" }));
vi.mock("./native", () => ({ getAlignmentExecutable: () => "worker" }));
vi.mock("./process", () => ({ runAlignmentNative: mocks.run }));
import { runPrimaryAlignment } from "./acoustic";
import type { LocalAlignmentRequest } from "@shared/types/lyricAlignment";
const request: LocalAlignmentRequest = {
  requestId: "test",
  translation: false,
  romanization: false,
  primary: { trackId: "song", language: "zh" },
  lines: [
    {
      id: 0,
      words: ["你好"],
      translation: "",
      romanization: "",
      primary: { startTime: 1000, endTime: 3000 },
    },
  ],
};
const result = {
  lines: [
    {
      id: 0,
      primary: {
        score: 0.7,
        words: [
          { word: "你", startTime: 1100, endTime: 1300 },
          { word: "好", startTime: 1700, endTime: 2500 },
        ],
      },
    },
  ],
};
beforeEach(() => {
  mocks.run.mockReset().mockResolvedValue(JSON.stringify(result));
  mocks.release.mockClear();
  mocks.current = "song";
  mocks.range.source = "C:/music/test.flac";
});

describe("主进程声学边界", () => {
  it("低评分及估算警告完整返回，不再限制生成", async () => {
    const low = {
      lines: [
        {
          id: 0,
          primary: { ...result.lines[0].primary, score: 0.001, warnings: ["需要试听检查"] },
        },
      ],
    };
    mocks.run.mockResolvedValue(JSON.stringify(low));
    expect(await runPrimaryAlignment(request, new AbortController().signal)).toEqual(low.lines);
  });
  it("音源来自已加载范围，CUE 起点只用于解码，结果仍为歌曲相对毫秒", async () => {
    expect(await runPrimaryAlignment(request, new AbortController().signal)).toEqual(result.lines);
    const input = JSON.parse(mocks.run.mock.calls[0][3]);
    expect(input.source).toBe("C:/music/test.flac");
    expect(input.offsetMs).toBe(10000);
    expect(input.lines[0].startTime).toBe(1000);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("拒绝未加载、其他歌曲及网络音源", async () => {
    mocks.current = "different";
    await expect(runPrimaryAlignment(request, new AbortController().signal)).rejects.toThrow();
    mocks.current = "song";
    mocks.range.source = "https://example.invalid/audio";
    await expect(runPrimaryAlignment(request, new AbortController().signal)).rejects.toThrow();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("拒绝原文被改写并总是释放模型租约", async () => {
    mocks.run.mockResolvedValue(
      JSON.stringify({
        lines: [
          {
            id: 0,
            primary: {
              ...result.lines[0].primary,
              words: [
                { word: "错", startTime: 1100, endTime: 1300 },
                result.lines[0].primary.words[1],
              ],
            },
          },
        ],
      }),
    );
    await expect(runPrimaryAlignment(request, new AbortController().signal)).rejects.toThrow(
      "改写",
    );
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("返回期间切歌或取消时不发布旧结果", async () => {
    mocks.run.mockImplementation(async () => {
      mocks.current = "next";
      return JSON.stringify(result);
    });
    await expect(runPrimaryAlignment(request, new AbortController().signal)).rejects.toThrow(
      "变化",
    );
    mocks.current = "song";
    const controller = new AbortController();
    mocks.run.mockImplementation(async () => {
      controller.abort();
      return JSON.stringify(result);
    });
    await expect(runPrimaryAlignment(request, controller.signal)).rejects.toThrow();
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
