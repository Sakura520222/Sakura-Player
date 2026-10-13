import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEndpoint: vi.fn<(factory: () => McpServer) => unknown>(),
  lightSnapshot: vi.fn(),
  trackCount: vi.fn(),
  albums: vi.fn(),
  artists: vi.fn(),
}));

vi.mock("@main/utils/config", () => ({ appVersion: "1.2.0-beta.1" }));
vi.mock("@main/services/engine", () => ({ getPlayer: vi.fn() }));
vi.mock("@main/services/playerControl", () => ({ playerControl: {} }));
vi.mock("@main/services/nowPlaying", () => ({ lightSnapshot: mocks.lightSnapshot }));
vi.mock("@main/database", () => ({
  getAlbumList: mocks.albums,
  getArtistList: mocks.artists,
  getTrackCount: mocks.trackCount,
  getRandomTracks: vi.fn(),
  searchTracks: vi.fn(),
}));
vi.mock("@main/services/tray", () => ({ getTrayPlayMode: vi.fn() }));
vi.mock("./endpoint", () => ({ createMcpEndpoint: mocks.createEndpoint }));
vi.mock("./onlineSearch", () => ({ searchOnlineTracks: vi.fn() }));
vi.mock("./cache", () => ({
  cacheTracks: vi.fn(),
  getTrackById: vi.fn(),
  getTracksByIds: vi.fn(),
}));

describe("MCP 资源 URI 兼容", () => {
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
});
