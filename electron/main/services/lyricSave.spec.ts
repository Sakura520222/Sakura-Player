import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@shared/types/player";

const state = vi.hoisted(() => ({
  enabled: true,
  dir: "",
  showSaveDialog: vi.fn(),
}));
vi.mock("electron", () => ({ dialog: { showSaveDialog: state.showSaveDialog } }));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key === "localLyric.repoDir" ? state.dir : state.enabled) },
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@main/database/lyricMatchCache", () => ({
  buildFingerprint: vi.fn(() => "fingerprint"),
  getMatchedId: vi.fn(() => null),
}));

import { saveLyricFiles } from "./lyricSave";
import { matchLocalTTML } from "./localLyricRepo";

let root: string;
let track: Track;
const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:amll="http://www.example.com/ns/amll"><head><metadata><amll:meta key="musicName" value="Song &amp; &quot;One&quot;"/><amll:meta key="artists" value="Artist &amp; Two"/><amll:meta key="ncmMusicId" value="local-1"/></metadata></head><body><div><p begin="1s" end="3s">歌词</p></div></body></tt>`;
const lrc = "[00:01.00]歌词\n[00:01.00]翻译";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sakura-lyric-save-test-"));
  state.dir = join(root, "repo");
  state.enabled = true;
  state.showSaveDialog.mockReset();
  await mkdir(state.dir);
  track = {
    id: "local-1",
    source: "local",
    path: join(root, "music.v2.flac"),
    title: 'Song & "One"',
    artists: [{ id: "a", name: "Artist & Two" }],
    duration: 3000,
  };
  await writeFile(track.path!, "audio fixture");
});
afterEach(async () => {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error("测试目录超出临时目录");
  await rm(root, { recursive: true, force: true });
});

describe("歌词文件保存", () => {
  it("覆盖同名 LRC，保存 UTF-8 TTML 后立即可按含 XML 特殊字符的歌曲匹配", async () => {
    await writeFile(join(root, "music.v2.lrc"), "old");
    const result = await saveLyricFiles({ track, lrc, ttml });
    expect(result.lrc).toEqual({ status: "saved", path: join(root, "music.v2.lrc") });
    expect(await readFile(join(root, "music.v2.lrc"), "utf8")).toBe(lrc);
    expect(result.ttml?.status).toBe("saved");
    expect(await matchLocalTTML(track)).toBe(ttml);
    expect(await readFile(track.path!, "utf8")).toBe("audio fixture");
  });

  it("覆盖已匹配的子目录 TTML 并刷新已有索引，不产生重复文件", async () => {
    const nested = join(state.dir, "nested");
    await mkdir(nested);
    const file = join(nested, "existing.ttml");
    const old = ttml;
    await writeFile(file, old);
    expect(await matchLocalTTML(track)).toBe(old);
    const parentMtime = (await stat(state.dir)).mtimeMs;
    const next = old.replace("歌词", "新歌词");
    expect((await saveLyricFiles({ track, ttml: next })).ttml).toEqual({
      status: "saved",
      path: file,
    });
    expect((await stat(state.dir)).mtimeMs).toBe(parentMtime);
    expect(await matchLocalTTML(track)).toBe(next);
    expect(await readdir(state.dir)).toEqual(["nested"]);
  });

  it("关闭本地库或未配置目录时不保存 TTML", async () => {
    state.enabled = false;
    expect(await saveLyricFiles({ track, ttml })).toEqual({});
    state.enabled = true;
    state.dir = "";
    expect(await saveLyricFiles({ track, ttml })).toEqual({});
    expect(await readdir(join(root, "repo"))).toEqual([]);
  });

  it("单个目标失败不阻止另一目标保存", async () => {
    const missingTrack = { ...track, path: join(root, "missing.flac") };
    const first = await saveLyricFiles({ track: missingTrack, lrc, ttml });
    expect(first.lrc?.status).toBe("failed");
    expect(first.ttml?.status).toBe("saved");
    state.dir = join(root, "missing-repo");
    const second = await saveLyricFiles({ track, lrc, ttml });
    expect(second.lrc?.status).toBe("saved");
    expect(second.ttml?.status).toBe("failed");
  });

  it.each(["online", "cue"])("%s 歌曲另存为 LRC，不改写音频旁的整轨歌词", async (source) => {
    const target = join(root, "export");
    state.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target });
    const item =
      source === "online"
        ? { ...track, source: "netease" as const }
        : { ...track, cuePath: join(root, "album.cue") };
    expect((await saveLyricFiles({ track: item, lrc })).lrc).toEqual({
      status: "saved",
      path: `${target}.lrc`,
    });
    expect(await readFile(`${target}.lrc`, "utf8")).toBe(lrc);
    expect(await readdir(root)).not.toContain("music.v2.lrc");
  });

  it("取消 LRC 另存为后仍按设置保存 TTML", async () => {
    state.showSaveDialog.mockResolvedValue({ canceled: true });
    const online = { ...track, source: "netease" as const };
    const result = await saveLyricFiles({ track: online, lrc, ttml });
    expect(result.lrc).toEqual({ status: "canceled" });
    expect(result.ttml?.status).toBe("saved");
    expect(await matchLocalTTML(online)).toBe(ttml);
  });
});
