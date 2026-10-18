import { callNetease } from "@main/apis/netease";
import { callKugou } from "@main/apis/kugou";
import {
  buildLyricSearchKeyword,
  normalize,
  pickBestCandidate,
  type LyricCandidate,
} from "@main/apis/common/lyric/utils";
import { coreLog } from "@main/utils/logger";
import type { Track } from "@shared/types/player";
import type { KGSong } from "@shared/types/platform/kugou";
import type {
  SongHighlight,
  SongHighlightPlatform,
  SongHighlightResponse,
} from "@shared/types/songHighlight";
import { normalizeHighlightSegments } from "@shared/utils/songHighlight";

const cache = new Map<string, { value: SongHighlight; expires: number }>();
const inflight = new Map<string, Promise<SongHighlightResponse>>();
const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_INFLIGHT = 8;

/**
 * 优先复用平台 ID，按元数据匹配时严格限制版本与时长差
 * @param platform - 查询的平台
 * @param track - 当前歌曲的元数据
 * @returns 平台歌曲 ID 或 Hash，无可靠匹配时返回 null
 */
const resolvePlatformId = async (
  platform: SongHighlightPlatform,
  track: Track,
): Promise<string | null> => {
  if (track.source === platform) {
    const valid = platform === "netease" ? /^\d+$/.test(track.id) : /^[a-f\d]{32}$/i.test(track.id);
    if (valid) return track.id;
  }
  if (!track.title.trim() || !track.artists.some((artist) => artist.name.trim())) return null;
  const keyword = buildLyricSearchKeyword(track);
  let candidates: LyricCandidate<string>[];
  if (platform === "netease") {
    const { status, body } = await callNetease("search", {
      keywords: keyword,
      type: 1,
      limit: 20,
    });
    if (status !== 200 || body.code !== 200) throw new Error("网易歌曲匹配失败");
    candidates = (body.result?.songs ?? []).map(
      (song: {
        id: number;
        name: string;
        artists?: { name: string }[];
        album?: { name: string };
        duration?: number;
      }) => ({
        name: song.name,
        artist: (song.artists ?? []).map((artist) => artist.name).join(" / "),
        album: song.album?.name,
        duration: song.duration,
        extra: String(song.id),
      }),
    );
  } else {
    const body = await callKugou<{ code: number; songs?: KGSong[] }>("search", {
      keywords: keyword,
      limit: 25,
    });
    if (body.code !== 200) throw new Error("酷狗歌曲匹配失败");
    candidates = (body.songs ?? []).map((song) => ({
      name: song.name,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      extra: song.hash,
    }));
  }
  const best = pickBestCandidate(
    candidates.filter(
      (candidate) =>
        normalize(candidate.name) === normalize(track.title) &&
        (!track.duration ||
          !candidate.duration ||
          Math.abs(candidate.duration - track.duration) <= 5000),
    ),
    track,
  );
  return best?.extra ?? null;
};

/**
 * 原平台优先查询，无标注或接口失败时尝试另一平台的同一版本
 * @param track - 待查询歌曲
 * @returns 标准化结果，保留无标注与网络失败的区别
 */
const queryHighlight = async (track: Track): Promise<SongHighlightResponse> => {
  const order: SongHighlightPlatform[] =
    track.source === "netease" ? ["netease", "kugou"] : ["kugou", "netease"];
  let failed = false;
  for (const platform of order) {
    try {
      const id = await resolvePlatformId(platform, track);
      if (!id) continue;
      let segments: { startMs: unknown; endMs?: unknown }[];
      if (platform === "netease") {
        const { status, body } = await callNetease("song_chorus", { id });
        if (status !== 200 || body.code !== 200) throw new Error("网易副歌查询失败");
        segments = (body.chorus ?? [])
          .filter((item: { id: number | string }) => String(item.id) === id)
          .map((item: { startTime: unknown; endTime?: unknown }) => ({
            startMs: item.startTime,
            endMs: item.endTime,
          }));
      } else {
        const body = await callKugou<{
          status: number;
          data?: { hash: string; start_time: unknown; end_time?: unknown }[];
        }>("song_climax", { hash: id });
        if (body.status !== 1) throw new Error("酷狗高潮查询失败");
        segments = (body.data ?? [])
          .filter((item) => item.hash.toLowerCase() === id.toLowerCase())
          .map((item) => ({ startMs: item.start_time, endMs: item.end_time }));
      }
      const normalized = normalizeHighlightSegments(segments, track.duration);
      if (normalized.length) {
        return {
          ok: true,
          data: {
            platform,
            platformId: id,
            matched: track.source !== platform || track.id !== id,
            segments: normalized,
          },
        };
      }
    } catch (error) {
      failed = true;
      coreLog.warn(`[highlight] ${platform} 查询失败:`, error);
    }
  }
  return failed ? { ok: false, error: "高潮查询失败" } : { ok: true, data: null };
};

/**
 * 查询当前歌曲高潮，合并并发请求并仅缓存有效的小型时间轴
 * @param track - 当前歌曲；不读取或上传音频文件
 * @returns 标准化的高潮标注或失败状态
 */
export const getSongHighlight = (track: Track): Promise<SongHighlightResponse> => {
  if (track.source === "plugin") return Promise.resolve({ ok: true, data: null });
  const key = JSON.stringify([
    track.source,
    track.id,
    track.serverId,
    track.originalId,
    track.serverRevision,
    track.album?.name,
    track.duration,
    track.title,
    track.artists.map((artist) => artist.name),
  ]);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    if (cached.expires > Date.now()) {
      cache.set(key, cached);
      return Promise.resolve({ ok: true, data: cached.value });
    }
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  if (inflight.size >= MAX_INFLIGHT) return Promise.resolve({ ok: false, error: "高潮查询繁忙" });
  const task = queryHighlight(track)
    .then((result) => {
      if (result.ok && result.data) {
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, { value: result.data, expires: Date.now() + CACHE_TTL_MS });
      }
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
};
