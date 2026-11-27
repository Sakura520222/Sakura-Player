import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEndpoint: vi.fn<(factory: () => McpServer) => unknown>(),
  lightSnapshot: vi.fn(),
  snapshot: vi.fn(),
  highlight: vi.fn(),
  trackCount: vi.fn(),
  albums: vi.fn(),
  artists: vi.fn(),
  getQueue: vi.fn(),
}));

vi.mock("@main/utils/config", () => ({ appVersion: "1.2.0-beta.1" }));
vi.mock("@main/services/playerControl", () => ({
  playerControl: { getQueue: mocks.getQueue },
}));
vi.mock("@main/services/nowPlaying", () => ({
  lightSnapshot: mocks.lightSnapshot,
  snapshot: mocks.snapshot,
}));
vi.mock("@main/services/songHighlight", () => ({ getSongHighlight: mocks.highlight }));
vi.mock("@main/database", () => ({
  getAlbumList: mocks.albums,
  getArtistList: mocks.artists,
  getTrackCount: mocks.trackCount,
  getRandomTracks: vi.fn(),
  searchTracks: vi.fn(),
}));
vi.mock("./endpoint", () => ({ createMcpEndpoint: mocks.createEndpoint }));
vi.mock("@main/services/music/onlineSearch", () => ({ searchOnlineTracks: vi.fn() }));

describe("MCP 资源与播放队列", () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.lightSnapshot.mockReturnValue({ track: { id: "current-track" }, positionMs: 2500 });
    mocks.trackCount.mockReturnValue(12);
    mocks.albums.mockReturnValue([{ id: "album" }]);
    mocks.artists.mockReturnValue([{ id: "artist-a" }, { id: "artist-b" }]);

    const { createMcpEndpoint } = await import("./server");
    createMcpEndpoint();
    server = mocks.createEndpoint.mock.calls[0][0]();
    client = new Client({ name: "compatibility-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("客户端可发现新资源和两个旧 URI 别名", async () => {
    const result = await client.listResources();
    expect(result.resources.map((resource) => resource.uri).sort()).toEqual(
      [
        "sakura-player://now-playing",
        "sakura-player://library/summary",
        "splayer://now-playing",
        "splayer://library/summary",
      ].sort(),
    );
  });

  it.each(["sakura-player", "splayer"])("%s 旧新地址均返回最新播放快照", async (scheme) => {
    const uri = `${scheme}://now-playing`;
    const snapshot = { track: { id: "next-track" }, positionMs: 5000 };
    mocks.lightSnapshot.mockReturnValue(snapshot);
    const result = await client.readResource({ uri });
    expect(result.contents).toEqual([
      { uri, mimeType: "application/json", text: JSON.stringify(snapshot) },
    ]);
  });

  it.each(["sakura-player", "splayer"])("%s 旧新地址均返回相同曲库摘要", async (scheme) => {
    const uri = `${scheme}://library/summary`;
    const result = await client.readResource({ uri });
    expect(result.contents).toEqual([
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({ tracks: 12, albums: 1, artists: 2 }),
      },
    ]);
  });

  it("通过真实 MCP 会话读取指定队列分页与全局播放索引", async () => {
    const snapshot = {
      tracks: [{ id: "queue-track", source: "local", path: "C:/music/track.wav" }],
      total: 120,
      currentIndex: 80,
      offset: 10,
    };
    mocks.getQueue.mockResolvedValue(snapshot);
    const result = await client.callTool({
      name: "get_queue",
      arguments: { offset: 10, limit: 2 },
    });
    expect(mocks.getQueue).toHaveBeenCalledWith({ offset: 10, limit: 2 });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(snapshot) }]);
  });

  it("队列查询使用有界的默认分页并保留空队列索引", async () => {
    const snapshot = { tracks: [], total: 0, currentIndex: -1, offset: 0 };
    mocks.getQueue.mockResolvedValue(snapshot);
    const result = await client.callTool({ name: "get_queue", arguments: {} });
    expect(mocks.getQueue).toHaveBeenCalledWith({ offset: 0, limit: 50 });
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(snapshot) }]);
  });

  it("按播放偏移和重叠行规则读取有限歌词，不返回音源路径", async () => {
    const lyric = Array.from({ length: 12 }, (_, index) => ({
      startTime: index * 1000,
      endTime: index * 1000 + 1000,
      isBG: false,
      words: [{ word: `line-${index}` }],
    }));
    mocks.snapshot.mockReturnValue({
      track: { title: "Current", path: "/private/music" },
      position: 4500,
      lyricOffsetMs: 1000,
      state: "playing",
      lyric,
    });
    const result = await client.callTool({ name: "get_current_lyric_context", arguments: {} });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          title: "Current",
          state: "playing",
          positionMs: 4500,
          lyricOffsetMs: 1000,
          currentIndex: 5,
          lines: [4, 5, 6].map((index) => ({
            index,
            startMs: index * 1000,
            endMs: index * 1000 + 1000,
            text: `line-${index}`,
          })),
        }),
      },
    ]);
    expect(
      (await client.callTool({ name: "get_current_lyric_context", arguments: { radius: 20 } }))
        .isError,
    ).toBe(true);
  });

  it("歌曲段落工具返回分来源状态及区间", async () => {
    const track = { id: "123", source: "netease", title: "Test", artists: [], duration: 1000 };
    const annotation = {
      ok: true,
      data: {
        segments: [
          {
            kind: "chorus",
            platform: "netease",
            platformId: "123",
            startMs: 120,
            confidence: "exact-id",
          },
        ],
      },
      sources: [
        { platform: "netease", status: "available" },
        { platform: "kugou", status: "unmatched" },
      ],
    };
    mocks.lightSnapshot.mockReturnValue({ track });
    mocks.highlight.mockResolvedValue(annotation);
    const result = await client.callTool({ name: "get_current_song_highlights", arguments: {} });
    expect(mocks.highlight).toHaveBeenCalledWith(track);
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ title: "Test", ...annotation }) },
    ]);
  });

  it("标注查询期间切换同 ID 的服务器时丢弃迟到的时间轴", async () => {
    const track = { id: "123", source: "streaming", serverId: "A", artists: [], duration: 1000 };
    mocks.lightSnapshot.mockReturnValue({ track });
    const settled = Promise.withResolvers<unknown>();
    mocks.highlight.mockReturnValue(settled.promise);
    const pending = client.callTool({ name: "get_current_song_highlights", arguments: {} });
    await vi.waitFor(() => expect(mocks.highlight).toHaveBeenCalled());
    mocks.lightSnapshot.mockReturnValue({ track: { ...track, serverId: "B" } });
    settled.resolve({ ok: true, data: null, sources: [] });
    expect((await pending).isError).toBe(true);
  });

  it("忽略元数据回退的完整文件路径与签名 URL，保留普通曲名", async () => {
    const { companionLabel } = await import("./musicContext");
    for (const value of [
      "C:\\Users\\listener\\track.flac",
      "C:Users\\listener\\track.flac",
      "\\\\server\\music",
      "/home/me/music",
      "~/Music/song.flac",
      "https://server/audio?token=private",
      "file:///private/music",
      "file:/private/music",
      "blob:https://example.com/uuid",
    ]) {
      expect(companionLabel(value)).toBe("");
    }
    expect(companionLabel("AC/DC")).toBe("AC/DC");
    expect(companionLabel("A: Prelude")).toBe("A: Prelude");
    expect(companionLabel("曲".repeat(400))).toHaveLength(320);
  });

  it("无当前播放歌曲时歌曲段落工具仍返回 ok: true", async () => {
    mocks.lightSnapshot.mockReturnValue({ track: null });
    const result = await client.callTool({ name: "get_current_song_highlights", arguments: {} });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify({ title: null, ok: true, data: null, sources: [] }) },
    ]);
  });

  it("陪伴通过同一注册表发现工具、执行只读查询并过滤私有字段", async () => {
    mocks.getQueue.mockResolvedValue({
      total: 1,
      tracks: [
        {
          id: "file:///private/song",
          title: "Song",
          path: "/private/song",
          cover: "https://server/?token=secret",
          artists: [{ name: "Artist", avatar: "file:///private/avatar" }],
          album: { name: "Album", id: "private" },
        },
      ],
    });
    mocks.albums.mockReturnValue([
      { name: "Album A", artist: "Artist A", trackCount: 10 },
      { name: "Album B", artist: "C:\\private\\dir", trackCount: 2 },
    ]);
    mocks.artists.mockReturnValue([{ name: "Artist A", trackCount: 10 }]);
    const { openCompanionTools } = await import("./companionTools");
    const abort = new AbortController();
    const session = await openCompanionTools(abort.signal);
    try {
      const names = session.tools.map((tool) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "get_queue",
          "get_current_lyric_context",
          "get_current_song_highlights",
        ]),
      );
      expect(names).not.toContain("seek");
      await expect(session.call("seek", { positionMs: 2000 })).rejects.toThrow("未授权");
      expect(JSON.parse(await session.call("get_queue", { limit: 1 }))).toEqual({
        total: 1,
        tracks: [{ title: "Song", artists: [{ name: "Artist" }], album: { name: "Album" } }],
      });
      expect(JSON.parse(await session.call("list_albums", {}))).toEqual({
        total: 2,
        albums: [
          { name: "Album A", artist: "Artist A", trackCount: 10 },
          { name: "Album B", artist: "", trackCount: 2 },
        ],
      });
      expect(JSON.parse(await session.call("list_artists", {}))).toEqual({
        total: 1,
        artists: [{ name: "Artist A", trackCount: 10 }],
      });
      mocks.getQueue.mockResolvedValueOnce({
        total: 32,
        tracks: Array.from({ length: 32 }, (_, idx) => ({
          title: `🎵"${"a".repeat(280)}"${idx}`,
          artists: Array.from({ length: 10 }, () => ({ name: `"x"${"b".repeat(80)}` })),
        })),
      });
      const huge = await session.call("get_queue", {});
      expect(huge.length).toBeLessThanOrEqual(16_000);
      const parsedHuge = JSON.parse(huge);
      expect(parsedHuge.truncated).toBe(true);
      expect(/[\uD800-\uDBFF]$/.test(parsedHuge.preview)).toBe(false);
      abort.abort();
      await expect(session.call("get_queue", {})).rejects.toThrow();
    } finally {
      await session.close();
    }
  });
});
