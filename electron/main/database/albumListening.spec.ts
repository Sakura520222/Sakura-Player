import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { AlbumListeningTrack } from "@shared/types/stats";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./index", () => ({ getDb: () => state.db }));
vi.mock("@main/utils/logger", () => ({ libraryLog: { error: vi.fn() } }));
import { getAlbumListeningStats } from "./playStats";

let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  state.db = db;
  db.exec(`CREATE TABLE play_history (
    track_id TEXT, source TEXT, started_at INTEGER, track_json TEXT
  )`);
});
afterEach(() => db.close());

/**
 * 插入指定媒体身份的历史记录
 * @param track - 曲目身份
 * @param at - 播放开始时间
 */
const record = (track: AlbumListeningTrack, at: number): void => {
  db.prepare("INSERT INTO play_history VALUES (?, ?, ?, ?)").run(
    track.id,
    track.source,
    at,
    JSON.stringify(track),
  );
};

describe("专辑听歌手记聚合", () => {
  it("累计所有曲目并选取首次时间，重复曲目不会重复计数", () => {
    const first = { id: "a", source: "local" } as const;
    const second = { id: "b", source: "local" } as const;
    record(first, 200);
    record(second, 100);
    record(first, 300);
    record({ id: "other", source: "local" }, 50);
    record({ id: "a", source: "netease" }, 10);
    expect(getAlbumListeningStats([first, second, first])).toEqual({
      playCount: 3,
      firstPlayedAt: 100,
    });
  });

  it("隔离串流服务器与媒体版本", () => {
    const track = { id: "same", source: "streaming", serverId: "one", serverRevision: 2 } as const;
    record(track, 200);
    record({ ...track, serverId: "two" }, 50);
    record({ ...track, serverRevision: 1 }, 100);
    expect(getAlbumListeningStats([track])).toEqual({ playCount: 1, firstPlayedAt: 200 });
  });

  it("空专辑和无播放记录返回空手记", () => {
    expect(getAlbumListeningStats([])).toEqual({ playCount: 0, firstPlayedAt: null });
    expect(getAlbumListeningStats([{ id: "a", source: "local" }])).toEqual({
      playCount: 0,
      firstPlayedAt: null,
    });
  });
});
