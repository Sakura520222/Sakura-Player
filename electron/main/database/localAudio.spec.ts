// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock("./index", () => ({ getDb: () => state.db }));
import { migrate } from "./migration";
import {
  getAlbumList,
  getAllTracks,
  getCueTrackPathsByDirs,
  getEmbeddedCueSheets,
  getFileRecords,
  getTracksByPaths,
  quickSearchLibrary,
  upsertTracks,
} from "./queries";

describe("本地音频标签迁移", () => {
  beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    state.db = Object.assign(db, {
      pragma: (statement: string, options?: { simple: boolean }) =>
        options?.simple
          ? Object.values(db.prepare("PRAGMA " + statement).get() ?? {})[0]
          : db.exec("PRAGMA " + statement),
      transaction: (operation: () => unknown) => () => {
        db.exec("BEGIN");
        try {
          const result = operation();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    });
    db.exec(
      [
        "PRAGMA user_version = 4",
        "CREATE TABLE lyric_match_cache (extra TEXT)",
        "CREATE TABLE tracks (id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, cue_path TEXT, cue_audio_path TEXT, cue_start_ms INTEGER, cue_end_ms INTEGER, title TEXT, track INTEGER, artists TEXT, album TEXT, duration INTEGER, cover TEXT, codec TEXT, sample_rate INTEGER, bit_rate INTEGER, channels INTEGER, bits_per_sample INTEGER, file_size INTEGER, file_mtime INTEGER, file_ctime INTEGER, scanned_at INTEGER)",
        "INSERT INTO tracks (id, path, title, artists, file_size, file_mtime, scanned_at) VALUES ('stable-id', 'song.flac', '旧标题', '[]', 12, 123, 1)",
      ].join("; "),
    );
  });

  afterEach(() => state.db?.close());

  it("保留旧曲目并在后续增量扫描时补录扩展字段", () => {
    migrate(state.db as unknown as Database.Database);
    expect(getAllTracks()[0]).toMatchObject({ id: "stable-id", title: "旧标题" });
    expect(getFileRecords()).toEqual([{ path: "song.flac", mtime: 0, size: 12 }]);
    const tags = {
      artists: ["A, B", "C/D"],
      albumArtists: ["专辑歌手"],
      genres: ["Pop", "Jazz"],
      composers: [],
      discNumber: 2,
      trackTotal: 8,
    };
    const scanned = {
      id: "different-id",
      path: "song.flac",
      title: "新标题",
      duration: 9000,
      artists: tags.artists.map((name) => ({ name })),
      album: { name: "测试专辑", artist: "专辑歌手" },
      localTags: tags,
      fileSize: 12,
      mtime: 456,
      ctime: 1,
      embeddedCue: 'FILE "song.flac" WAVE',
    };
    upsertTracks([scanned]);
    upsertTracks([{ ...scanned, title: "滞后的扫描" }], 1);
    expect(getAllTracks()[0]).toMatchObject({ id: "stable-id", title: "新标题", localTags: tags });
    expect(getTracksByPaths(["song.flac"])[0]?.id).toBe("stable-id");
    expect(getAlbumList()).toEqual([
      { name: "测试专辑", artist: "专辑歌手", cover: undefined, trackCount: 1 },
    ]);
    expect(quickSearchLibrary("测试专辑").albums).toEqual(getAlbumList());
    expect(getFileRecords()).toEqual([{ path: "song.flac", mtime: 456, size: 12 }]);
    expect(getEmbeddedCueSheets()).toEqual([
      { path: "song.flac", embedded_cue: scanned.embeddedCue },
    ]);
  });

  it("只清理指定字面量目录的 CUE 分轨", () => {
    migrate(state.db as unknown as Database.Database);
    const dir = path.resolve("album_set");
    const otherDir = path.resolve("albumXset");
    upsertTracks(
      [dir, otherDir].map((parent, index) => ({
        id: "cue-" + index,
        path: "cue-" + index,
        cuePath: path.join(parent, "record.cue"),
        title: "测试分轨",
        artists: [],
        duration: 30_000,
        fileSize: 12,
        mtime: 1,
        ctime: 1,
      })),
    );
    expect(getCueTrackPathsByDirs([dir])).toEqual(["cue-0"]);
  });
});
