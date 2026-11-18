import path from "node:path";
import type { Track, Artist, Album, AudioQuality } from "@shared/types/player";
import type { AlbumSummary, ArtistSummary, LibraryQuickSearchResult } from "@shared/types/library";
import type { LibraryStats } from "@shared/types/stats";
import { getDb } from "./index";

/** 数据库行类型 */
interface TrackRow {
  id: string;
  path: string;
  cue_path: string | null;
  cue_audio_path: string | null;
  cue_start_ms: number | null;
  cue_end_ms: number | null;
  title: string;
  track?: number;
  artists: string;
  album: string | null;
  duration: number;
  cover: string | null;
  codec: string | null;
  sample_rate: number | null;
  bit_rate: number | null;
  channels: number | null;
  bits_per_sample: number | null;
  local_tags: string | null;
  file_size: number;
  file_mtime: number | null;
  file_ctime: number | null;
  scanned_at: number;
}

/** 专辑聚合查询中的标签艺术家和歌曲艺术家 */
interface AlbumSummaryRow {
  name: string;
  cover: string | null;
  albumArtist: string | null;
  artists: string;
  trackCount: number;
}

/** 将数据库行解析为 Track */
const rowToTrack = (row: TrackRow): Track => {
  const quality: AudioQuality | undefined =
    row.codec != null
      ? {
          codec: row.codec,
          sampleRate: row.sample_rate ?? 0,
          bitRate: row.bit_rate ?? 0,
          channels: row.channels ?? 0,
          bitsPerSample: row.bits_per_sample ?? 0,
        }
      : undefined;

  return {
    id: row.id,
    source: "local",
    path: row.path,
    cuePath: row.cue_path ?? undefined,
    cueAudioPath: row.cue_audio_path ?? undefined,
    cueStartMs: row.cue_start_ms ?? undefined,
    cueEndMs: row.cue_end_ms ?? undefined,
    title: row.title,
    track: row.track ?? undefined,
    artists: JSON.parse(row.artists) as Artist[],
    album: row.album ? (JSON.parse(row.album) as Album) : undefined,
    duration: row.duration,
    cover: row.cover ?? undefined,
    fileSize: row.file_size ?? undefined,
    mtime: row.file_mtime ?? undefined,
    ctime: row.file_ctime ?? undefined,
    localTags: row.local_tags ? (JSON.parse(row.local_tags) as Track["localTags"]) : undefined,
    quality,
  };
};

/** 查询全部曲目（含被 CUE 引用的容器整轨，供扫描器读取时长/封面等） */
export const getAllTracks = (): Track[] => {
  const rows = getDb().prepare("SELECT * FROM tracks").all() as TrackRow[];
  return rows.map(rowToTrack);
};

/**
 * 按保存路径取得写回后的曲目，保留数据库已有的曲目身份
 * @param paths - 已写回的实体文件路径
 * @returns 对应的曲库记录
 */
export const getTracksByPaths = (paths: string[]): Track[] => {
  if (paths.length === 0) return [];
  const rows = getDb()
    .prepare("SELECT t.* FROM json_each(?) p JOIN tracks t ON t.path = p.value")
    .all(JSON.stringify(paths)) as TrackRow[];
  return rows.map(rowToTrack);
};

/**
 * 排除被 CUE 分轨引用的容器整轨文件的 WHERE 片段
 * 容器整轨（如整张原盘 flac）已被虚拟分轨取代，不应在曲库中重复出现
 * @param col - 外层曲目的 path 列（json_each 也有 path 列，带别名时须显式限定）
 */
const excludeCueContainer = (col = "path"): string =>
  `${col} NOT IN (SELECT cue_audio_path FROM tracks WHERE cue_audio_path IS NOT NULL)`;

/** 获取曲目总数（不含 CUE 容器整轨） */
export const getTrackCount = (): number => {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as count FROM tracks WHERE ${excludeCueContainer()}`)
    .get() as { count: number };
  return row.count;
};

/** 随机取一首曲目，库为空时返回 null */
export const getRandomTrack = (): Track | null => {
  const row = getDb()
    .prepare(`SELECT * FROM tracks WHERE ${excludeCueContainer()} ORDER BY RANDOM() LIMIT 1`)
    .get() as TrackRow | undefined;
  return row ? rowToTrack(row) : null;
};

/** 随机取多首曲目 */
export const getRandomTracks = (limit: number): Track[] => {
  const safe = Math.max(0, Math.min(limit | 0, 500));
  if (safe === 0) return [];
  const rows = getDb()
    .prepare(`SELECT * FROM tracks WHERE ${excludeCueContainer()} ORDER BY RANDOM() LIMIT ?`)
    .all(safe) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 用于增量扫描比对的文件记录 */
export interface FileRecord {
  path: string;
  mtime: number;
  size: number;
}

/** 获取所有真实音频文件记录（path + mtime + size），用于增量扫描比对 */
export const getFileRecords = (): FileRecord[] => {
  return getDb()
    .prepare(
      "SELECT path, CASE WHEN local_tags IS NULL THEN 0 ELSE COALESCE(file_mtime, 0) END as mtime, file_size as size FROM tracks WHERE cue_path IS NULL",
    )
    .all() as FileRecord[];
};

/** 批量插入/更新的扫描结果 */
export interface UpsertTrack {
  id: string;
  path: string;
  cuePath?: string;
  cueAudioPath?: string;
  cueStartMs?: number;
  cueEndMs?: number;
  title: string;
  track?: number;
  artists: Artist[];
  album?: Album;
  duration: number;
  cover?: string;
  codec?: string;
  sampleRate?: number;
  bitRate?: number;
  channels?: number;
  bitsPerSample?: number;
  localTags?: Track["localTags"];
  embeddedCue?: string;
  fileSize: number;
  mtime: number;
  ctime: number;
}

/**
 * 批量更新曲目，保留路径关联的曲目 ID
 * @param tracks - 要写入的扫描或编辑结果
 * @param scannedBefore - 扫描开始时间，用于保护并发写回的新标签
 */
export const upsertTracks = (tracks: UpsertTrack[], scannedBefore?: number): void => {
  if (tracks.length === 0) return;
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO tracks
      (id, path, cue_path, cue_audio_path, cue_start_ms, cue_end_ms, title, track, artists, album, duration, cover, codec, sample_rate, bit_rate, channels, bits_per_sample, local_tags, embedded_cue, file_size, file_mtime, file_ctime, scanned_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      cue_path = excluded.cue_path, cue_audio_path = excluded.cue_audio_path,
      cue_start_ms = excluded.cue_start_ms, cue_end_ms = excluded.cue_end_ms,
      title = excluded.title, track = excluded.track, artists = excluded.artists,
      album = excluded.album, duration = excluded.duration, cover = excluded.cover,
      codec = excluded.codec, sample_rate = excluded.sample_rate, bit_rate = excluded.bit_rate,
      channels = excluded.channels, bits_per_sample = excluded.bits_per_sample,
      local_tags = excluded.local_tags, embedded_cue = excluded.embedded_cue,
      file_size = excluded.file_size, file_mtime = excluded.file_mtime, file_ctime = excluded.file_ctime,
      scanned_at = excluded.scanned_at
    WHERE tracks.scanned_at <= ?
  `);
  const now = Date.now();
  const tx = d.transaction(() => {
    for (const t of tracks) {
      stmt.run(
        t.id,
        t.path,
        t.cuePath ?? null,
        t.cueAudioPath ?? null,
        t.cueStartMs ?? null,
        t.cueEndMs ?? null,
        t.title,
        t.track ?? null,
        JSON.stringify(t.artists),
        t.album ? JSON.stringify(t.album) : null,
        t.duration,
        t.cover ?? null,
        t.codec ?? null,
        t.sampleRate ?? null,
        t.bitRate ?? null,
        t.channels ?? null,
        t.bitsPerSample ?? null,
        t.localTags ? JSON.stringify(t.localTags) : null,
        t.embeddedCue ?? null,
        t.fileSize,
        t.mtime,
        t.ctime,
        now,
        scannedBefore ?? now,
      );
    }
  });
  tx();
};

/**
 * 更新编辑后仍从实体音频继承封面、大小和音质的 CUE 曲目
 * @param tracks - 写入成功的实体曲目
 */
export const refreshCueContainers = (tracks: UpsertTrack[]): void => {
  const db = getDb();
  const update = db.prepare(`
    UPDATE tracks SET cover = ?, file_size = ?, codec = ?, sample_rate = ?,
      bit_rate = ?, channels = ?, bits_per_sample = ?
    WHERE cue_audio_path = ?
  `);
  db.transaction(() => {
    for (const track of tracks) {
      update.run(
        track.cover ?? null,
        track.fileSize,
        track.codec ?? null,
        track.sampleRate ?? null,
        track.bitRate ?? null,
        track.channels ?? null,
        track.bitsPerSample ?? null,
        track.path,
      );
    }
  })();
};

/**
 * 读取曲库内嵌的 CUE 文本，仅在扫描收尾使用
 * @returns 实体音频路径及对应文本
 */
export const getEmbeddedCueSheets = (): { path: string; embedded_cue: string }[] =>
  getDb().prepare("SELECT path, embedded_cue FROM tracks WHERE embedded_cue IS NOT NULL").all() as {
    path: string;
    embedded_cue: string;
  }[];

/**
 * 按字面量目录前缀查询 CUE 虚拟曲目
 * @param dirs - 本次实际扫描的目录
 */
export const getCueTrackPathsByDirs = (dirs: string[]): string[] => {
  if (dirs.length === 0) return [];
  const rows: { path: string }[] = [];
  const stmt = getDb().prepare("SELECT path FROM tracks WHERE cue_path LIKE ? ESCAPE '\\'");
  for (const dir of dirs) {
    const prefix = dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + path.sep;
    rows.push(...(stmt.all(prefix.replace(/[%_\\]/g, "\\$&") + "%") as { path: string }[]));
  }
  return rows.map((row) => row.path);
};

/** 批量删除曲目（按路径） */
export const deleteTracksByPaths = (paths: string[]): void => {
  if (paths.length === 0) return;
  const d = getDb();
  const removeMemberships = d.prepare(
    `DELETE FROM playlist_tracks
     WHERE playlist_id IN (SELECT id FROM playlists WHERE type = 'local')
       AND track_id IN (
         SELECT id FROM tracks WHERE path = ? OR cue_audio_path = ? OR cue_path = ?
       )`,
  );
  const stmt = d.prepare("DELETE FROM tracks WHERE path = ? OR cue_audio_path = ? OR cue_path = ?");
  const tx = d.transaction(() => {
    for (const p of paths) {
      removeMemberships.run(p, p, p);
      stmt.run(p, p, p);
    }
  });
  tx();
};

/** 模糊搜索曲目（title / artists / album） */
export const searchTracks = (query: string): Track[] => {
  const escaped = query.replace(/[%_\\]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks WHERE (title LIKE ? ESCAPE '\\' OR artists LIKE ? ESCAPE '\\' OR album LIKE ? ESCAPE '\\') AND ${excludeCueContainer()}`,
    )
    .all(pattern, pattern, pattern) as TrackRow[];
  return rows.map(rowToTrack);
};

/**
 * 搜索窗用的本地曲库分组搜索，只按名称字段匹配，避免命中 JSON 键名
 * @param keyword - 搜索关键词
 * @returns 歌曲、专辑、歌手各自的少量匹配结果
 */
export const quickSearchLibrary = (keyword: string): LibraryQuickSearchResult => {
  const params = { pattern: `%${keyword.replace(/[%_\\]/g, "\\$&")}%` };
  const database = getDb();
  const trackRows = database
    .prepare(
      `SELECT * FROM tracks
       WHERE (title LIKE @pattern ESCAPE '\\'
         OR json_extract(album, '$.name') LIKE @pattern ESCAPE '\\'
         OR EXISTS (
           SELECT 1 FROM json_each(artists) a
           WHERE json_extract(a.value, '$.name') LIKE @pattern ESCAPE '\\'
         ))
         AND ${excludeCueContainer()}
       ORDER BY (title LIKE @pattern ESCAPE '\\') DESC
       LIMIT 5`,
    )
    .all(params) as TrackRow[];
  const albumRows = database
    .prepare(
      `SELECT
         json_extract(album, '$.name') AS name,
         MAX(CASE WHEN cover IS NOT NULL THEN cover END) AS cover,
         MAX(NULLIF(json_extract(album, '$.artist'), '')) AS albumArtist,
         MAX(artists) AS artists,
         COUNT(*) AS trackCount
       FROM tracks
       WHERE json_extract(album, '$.name') LIKE @pattern ESCAPE '\\'
         AND ${excludeCueContainer()}
       GROUP BY name
       LIMIT 3`,
    )
    .all(params) as AlbumSummaryRow[];
  const artistRows = database
    .prepare(
      `SELECT
         json_extract(a.value, '$.name') AS name,
         COUNT(DISTINCT t.id) AS trackCount,
         MAX(CASE WHEN t.cover IS NOT NULL THEN t.cover END) AS cover
       FROM tracks t, json_each(t.artists) a
       WHERE json_extract(a.value, '$.name') LIKE @pattern ESCAPE '\\'
         AND ${excludeCueContainer("t.path")}
       GROUP BY name
       LIMIT 3`,
    )
    .all(params) as { name: string; trackCount: number; cover: string | null }[];
  return {
    tracks: trackRows.map(rowToTrack),
    albums: albumRows.map((row) => ({
      name: row.name,
      cover: row.cover ?? undefined,
      artist:
        row.albumArtist ??
        (JSON.parse(row.artists) as Artist[]).map((artist) => artist.name).join(" / "),
      trackCount: row.trackCount,
    })),
    artists: artistRows.map((row) => ({
      name: row.name,
      trackCount: row.trackCount,
      cover: row.cover ?? undefined,
    })),
  };
};

/** 删除指定目录下的所有曲目 */
export const deleteTracksByDir = (dir: string): void => {
  const prefix = dir.endsWith("/") || dir.endsWith("\\") ? dir : dir + path.sep;
  const patterns = [prefix + "%", prefix + "%", prefix + "%"];
  const database = getDb();
  database.transaction(() => {
    database
      .prepare(
        `DELETE FROM playlist_tracks
         WHERE playlist_id IN (SELECT id FROM playlists WHERE type = 'local')
           AND track_id IN (
             SELECT id FROM tracks WHERE path LIKE ? OR cue_path LIKE ? OR cue_audio_path LIKE ?
           )`,
      )
      .run(...patterns);
    database
      .prepare("DELETE FROM tracks WHERE path LIKE ? OR cue_path LIKE ? OR cue_audio_path LIKE ?")
      .run(...patterns);
  })();
};

/** 专辑列表 */
export const getAlbumList = (): AlbumSummary[] => {
  const rows = getDb()
    .prepare(
      `SELECT
         json_extract(album, '$.name') AS name,
         MAX(CASE WHEN cover IS NOT NULL THEN cover END) AS cover,
         MAX(NULLIF(json_extract(album, '$.artist'), '')) AS albumArtist,
         MAX(artists) AS artists,
         COUNT(*) AS trackCount
       FROM tracks
       WHERE album IS NOT NULL AND json_extract(album, '$.name') IS NOT NULL
         AND ${excludeCueContainer()}
       GROUP BY name`,
    )
    .all() as AlbumSummaryRow[];
  return rows.map((row) => ({
    name: row.name,
    cover: row.cover ?? undefined,
    artist: row.albumArtist ?? (JSON.parse(row.artists) as Artist[]).map((a) => a.name).join(" / "),
    trackCount: row.trackCount,
  }));
};

/** 歌手列表 */
export const getArtistList = (): ArtistSummary[] => {
  const rows = getDb()
    .prepare(
      `SELECT
         json_extract(a.value, '$.name') AS name,
         COUNT(DISTINCT t.id) AS trackCount,
         MAX(CASE WHEN t.cover IS NOT NULL THEN t.cover END) AS cover
       FROM tracks t, json_each(t.artists) a
       WHERE json_extract(a.value, '$.name') IS NOT NULL
         AND TRIM(json_extract(a.value, '$.name')) != ''
         AND ${excludeCueContainer("t.path")}
       GROUP BY name`,
    )
    .all() as { name: string; trackCount: number; cover: string | null }[];
  return rows.map((row) => ({
    name: row.name,
    trackCount: row.trackCount,
    cover: row.cover ?? undefined,
  }));
};

/** 按专辑名获取全部曲目 */
export const getAlbumTracks = (albumName: string): Track[] => {
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks WHERE json_extract(album, '$.name') = ? AND ${excludeCueContainer()}
       ORDER BY COALESCE(json_extract(local_tags, '$.discNumber'), 1), track IS NULL, track, title COLLATE NOCASE`,
    )
    .all(albumName) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 按歌手名获取全部曲目 */
export const getArtistTracks = (artistName: string): Track[] => {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT t.* FROM tracks t, json_each(t.artists) a
       WHERE LOWER(json_extract(a.value, '$.name')) = LOWER(?)
         AND ${excludeCueContainer("t.path")}`,
    )
    .all(artistName) as TrackRow[];
  return rows.map(rowToTrack);
};

/** 音乐库统计概览：数量、总时长/大小与格式分布 */
export const getLibraryStats = (): LibraryStats => {
  const d = getDb();
  const aggregate = d
    .prepare(
      `SELECT COUNT(*) AS trackCount,
              COALESCE(SUM(duration), 0) AS totalDurationMs,
              COALESCE(SUM(file_size), 0) AS totalFileSize
       FROM tracks
       WHERE ${excludeCueContainer()}`,
    )
    .get() as { trackCount: number; totalDurationMs: number; totalFileSize: number };

  const albumRow = d
    .prepare(
      `SELECT COUNT(DISTINCT json_extract(album, '$.name')) AS count
       FROM tracks
       WHERE album IS NOT NULL AND json_extract(album, '$.name') IS NOT NULL
         AND ${excludeCueContainer()}`,
    )
    .get() as { count: number };

  const artistRow = d
    .prepare(
      `SELECT COUNT(DISTINCT json_extract(a.value, '$.name')) AS count
       FROM tracks t, json_each(t.artists) a
       WHERE json_extract(a.value, '$.name') IS NOT NULL
         AND TRIM(json_extract(a.value, '$.name')) != ''
         AND ${excludeCueContainer("t.path")}`,
    )
    .get() as { count: number };

  const codecs = d
    .prepare(
      `SELECT COALESCE(codec, '') AS codec, COUNT(*) AS count
       FROM tracks
       WHERE ${excludeCueContainer()}
       GROUP BY codec
       ORDER BY count DESC, codec`,
    )
    .all() as { codec: string; count: number }[];

  return {
    trackCount: aggregate.trackCount,
    albumCount: albumRow.count,
    artistCount: artistRow.count,
    totalDurationMs: aggregate.totalDurationMs,
    totalFileSize: aggregate.totalFileSize,
    codecs,
  };
};

/** 按 ID 批量获取曲目 */
export const getTracksByIds = (ids: string[]): Track[] => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM tracks WHERE id IN (${placeholders})`)
    .all(...ids) as TrackRow[];
  return rows.map(rowToTrack);
};
