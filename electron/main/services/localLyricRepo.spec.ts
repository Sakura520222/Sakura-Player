import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Track } from "@shared/types/player";

const fixtures = vi.hoisted(() => ({
  dir: "",
  enabled: true,
  matchedIds: new Map<string, { platformId: string; extra?: { mid?: string } }>(),
}));

vi.mock("@main/store", () => ({
  store: {
    get: (key: string) => (key === "localLyric.repoDir" ? fixtures.dir : fixtures.enabled),
  },
}));

vi.mock("@main/database/lyricMatchCache", () => ({
  buildFingerprint: () => "fingerprint",
  getMatchedId: (_fingerprint: string, platform: string) => fixtures.matchedIds.get(platform),
}));

vi.mock("@main/utils/logger", () => ({ coreLog: { info: vi.fn(), warn: vi.fn() } }));

import { getLocalTTMLSavePath, matchLocalTTML, saveLocalTTML } from "./localLyricRepo";

const content = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:amll="http://www.example.com/ns/amll">
  <head><metadata>
    <amll:meta key="musicName" value="A &amp; B" />
    <amll:meta key="artists" value="Singer" />
    <amll:meta key="ncmMusicId" value="1001" />
    <amll:meta key="ncmMusicId" value="1002" />
    <amll:meta key="qqMusicId" value="qq-first" />
    <amll:meta key="qqMusicId" value="qq-second" />
  </metadata></head>
  <body><div><p begin="0s" end="1s">Original</p></div></body>
</tt>`;

/**
 * 构建标题无法兜底匹配的歌曲，确保测试命中平台 ID 索引
 * @param source - 歌曲来源
 * @param id - 平台歌曲 ID
 * @returns 测试歌曲
 */
const makeTrack = (source: Track["source"], id: string): Track => ({
  source,
  id,
  title: "Different title",
  artists: [{ name: "Another singer" }],
  duration: 1000,
});

describe("本地 TTML 多值元数据索引", () => {
  beforeEach(async () => {
    fixtures.dir = await mkdtemp(join(tmpdir(), "sakura-ttml-"));
    fixtures.enabled = true;
    fixtures.matchedIds.clear();
    await writeFile(join(fixtures.dir, "existing.ttml"), content);
  });

  afterEach(async () => {
    expect(dirname(resolve(fixtures.dir))).toBe(resolve(tmpdir()));
    expect(basename(fixtures.dir)).toMatch(/^sakura-ttml-/);
    await rm(fixtures.dir, { recursive: true, force: true });
  });

  it.each([
    ["netease", "1001"],
    ["netease", "1002"],
    ["qqmusic", "qq-first"],
    ["qqmusic", "qq-second"],
  ] as const)("通过 %s 的平台 ID %s 匹配同一文件", async (source, id) => {
    expect(await matchLocalTTML(makeTrack(source, id))).toBe(content);
  });

  it("通过 QQ 歌曲的 mid 命中第二个 ID", async () => {
    expect(await matchLocalTTML({ ...makeTrack("qqmusic", "unknown"), extId: "qq-second" })).toBe(
      content,
    );
  });

  it("通过本地歌曲的缓存平台 ID 命中第二个 ID", async () => {
    fixtures.matchedIds.set("netease", { platformId: "1002" });
    expect(await matchLocalTTML(makeTrack("local", "local-track"))).toBe(content);
    fixtures.matchedIds.clear();
    fixtures.matchedIds.set("qqmusic", { platformId: "unknown", extra: { mid: "qq-second" } });
    expect(await matchLocalTTML(makeTrack("local", "local-track"))).toBe(content);
  });

  it.each([
    ["netease", "1002"],
    ["qqmusic", "qq-second"],
  ] as const)("通过 %s 的第二个 ID 复用已有保存路径并重新读取", async (source, id) => {
    const track = makeTrack(source, id);
    const existing = join(fixtures.dir, "existing.ttml");
    const updated = content.replace("Original", "Updated");
    expect(await getLocalTTMLSavePath(track)).toBe(existing);
    expect(await saveLocalTTML(track, updated)).toBe(existing);
    expect(await readFile(existing, "utf8")).toBe(updated);
    expect(await matchLocalTTML(track)).toBe(updated);
  });

  it("保留实体解码后的标题匹配", async () => {
    expect(await matchLocalTTML({ ...makeTrack("local", "local-track"), title: "A & B" })).toBe(
      content,
    );
  });

  it("关闭本地覆盖时不返回匹配结果", async () => {
    fixtures.enabled = false;
    expect(await matchLocalTTML(makeTrack("netease", "1002"))).toBeNull();
  });
});
