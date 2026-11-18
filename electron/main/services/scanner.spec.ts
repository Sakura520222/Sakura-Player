// @vitest-environment node
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JsScanEvent } from "@splayer/audio-engine";

const mocks = vi.hoisted(() => ({
  callbacks: [] as ((event: JsScanEvent) => void)[],
  cancelScan: vi.fn(),
  getAllTracks: vi.fn(),
  upsertTracks: vi.fn(),
  readCue: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { stat: vi.fn(async () => ({ mtimeMs: 20, ctimeMs: 10 })) },
}));
vi.mock("./engine", () => ({
  getEngine: () => ({
    scanDirs: (_dirs: string[], callback: (event: JsScanEvent) => void) =>
      mocks.callbacks.push(callback),
    cancelScan: mocks.cancelScan,
  }),
}));
vi.mock("@main/database", () => ({
  deleteTracksByPaths: vi.fn(),
  getAllTracks: mocks.getAllTracks,
  getCueTrackPathsByDirs: () => [],
  getEmbeddedCueSheets: () => [],
  getFileRecords: () => [],
  upsertTracks: mocks.upsertTracks,
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@main/utils/config", () => ({
  getCoverCacheDir: () => "/cache",
  isWin: process.platform === "win32",
}));
vi.mock("@main/utils/protocol", () => ({ toCacheUrl: (url: string) => url }));
vi.mock("@main/utils/logger", () => ({
  libraryLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@main/utils/encoding", () => ({ readFileAutoEncoding: mocks.readCue }));

import { cancelScan, isScanning, startScan } from "./scanner";

const dir = path.resolve("sakura-cue-scan-fixture");
const filePath = path.join(dir, "album.flac");
const cuePath = path.join(dir, "album.cue");
const content = 'FILE "album.flac" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00';
const done: JsScanEvent = { eventType: "done", scanned: 1, total: 1, cueFiles: [cuePath] };

describe("扫描收尾", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.callbacks.length = 0;
  });

  afterEach(() => cancelScan());

  it("取消的旧扫描不能写库或结束已启动的新任务", async () => {
    let finishRead!: (text: string) => void;
    mocks.readCue.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishRead = resolve;
      }),
    );
    startScan([dir], false);
    mocks.callbacks[0](done);
    await vi.waitFor(() => expect(mocks.readCue).toHaveBeenCalledWith(cuePath));

    cancelScan();
    startScan([dir], false);
    mocks.callbacks[0]({ eventType: "progress", scanned: 1, total: 1 });
    finishRead(content);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.getAllTracks).not.toHaveBeenCalled();
    expect(mocks.upsertTracks).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(isScanning()).toBe(true);
    mocks.getAllTracks.mockReturnValue([]);
    mocks.callbacks[1]({ eventType: "done", scanned: 0, total: 0 });
    await vi.waitFor(() => expect(isScanning()).toBe(false));
  });

  it("读完 CUE 后继承等待期间保存的新封面", async () => {
    let finishRead!: (text: string) => void;
    mocks.readCue.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        finishRead = resolve;
      }),
    );
    const album = { id: "album", path: filePath, duration: 30_000, cover: "previous", artists: [] };
    mocks.getAllTracks.mockReturnValue([album]);
    startScan([dir], false);
    mocks.callbacks[0](done);
    await vi.waitFor(() => expect(mocks.readCue).toHaveBeenCalledWith(cuePath));

    mocks.getAllTracks.mockReturnValue([{ ...album, cover: "current" }]);
    finishRead(content);
    await vi.waitFor(() => expect(isScanning()).toBe(false));
    expect(mocks.upsertTracks).toHaveBeenCalledWith([
      expect.objectContaining({ cueAudioPath: filePath, cover: "current" }),
    ]);
  });
});
