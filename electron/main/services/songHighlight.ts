import { callNetease } from "@main/apis/netease";
import { callKugou } from "@main/apis/kugou";
import {
  buildLyricSearchKeyword,
  normalize,
  pickBestCandidate,
  type LyricCandidate,
} from "@main/apis/common/lyric/utils";
import { isMediaLocation } from "./music/metadata";
import { coreLog } from "@main/utils/logger";
import type { Track } from "@shared/types/player";
import type { KGSong } from "@shared/types/platform/kugou";
import type {
  SongHighlightSegment,
  SongHighlightSource,
  SongHighlightPlatform,
  SongHighlightResponse,
} from "@shared/types/songHighlight";
import { getSongHighlightKey, normalizeHighlightSegments } from "@shared/utils/songHighlight";

const cache = new Map<string, { value: SongHighlightResponse; expires: number }>();
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
  if (
    !track.title.trim() ||
    isMediaLocation(track.title) ||
    !track.artists.some((artist) => artist.name.trim()) ||
    track.artists.some((artist) => isMediaLocation(artist.name))
  )
    return null;
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
 * 查询一个平台的版本与标注，并保留匹配依据
 * @param track - 当前曲目
 * @param platform - 标注来源
 * @returns 平台查询状态及有效区间
 */
const queryPlatform = async (
  track: Track,
  platform: SongHighlightPlatform,
): Promise<{ source: SongHighlightSource; segments: SongHighlightSegment[] }> => {
  try {
    const id = await resolvePlatformId(platform, track);
    if (!id) return { source: { platform, status: "unmatched" }, segments: [] };
    let segments: { startMs: unknown; endMs?: unknown }[];
    if (platform === "netease") {
      const { status, body } = await callNetease("song_chorus", { id });
      if (status !== 200 || body.code !== 200) throw new Error("网易副歌查询失败");
      segments = (body.chorus ?? [])
        .filter((item: { id: number | string } | null) => item != null && String(item.id) === id)
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
        .filter(
          (item) => typeof item?.hash === "string" && item.hash.toLowerCase() === id.toLowerCase(),
        )
        .map((item) => ({ startMs: item.start_time, endMs: item.end_time }));
    }
    const normalized = normalizeHighlightSegments(segments, track.duration);
    return {
      source: { platform, status: normalized.length ? "available" : "empty" },
      segments: normalized.map((range) => ({
        ...range,
        platform,
        platformId: id,
        kind: platform === "netease" ? "chorus" : "climax",
        confidence: track.source === platform && track.id === id ? "exact-id" : "metadata",
      })),
    };
  } catch (error) {
    coreLog.warn(`[highlight] ${platform} 查询失败:`, error);
    return { source: { platform, status: "error" }, segments: [] };
  }
};

/**
 * 合并两平台同一版本的有效时间轴，保留同起点的不同标注类型
 * @param track - 待查询歌曲
 * @returns 有序标注和每个平台的降级原因
 */
const queryHighlight = async (track: Track): Promise<SongHighlightResponse> => {
  const results = await Promise.all([
    queryPlatform(track, "netease"),
    queryPlatform(track, "kugou"),
  ]);
  const sources = results.map((result) => result.source);
  const segments = results
    .flatMap((result) => result.segments)
    .sort((a, b) => a.startMs - b.startMs);
  if (segments.length) return { ok: true, data: { segments }, sources };
  return sources.some((source) => source.status === "error")
    ? { ok: false, error: "歌曲段落查询失败", sources }
    : { ok: true, data: null, sources };
};

/**
 * 查询当前歌曲高潮，合并并发请求并仅缓存有效的小型时间轴
 * @param track - 当前歌曲；不读取或上传音频文件
 * @returns 标准化的高潮标注或失败状态
 */
export const getSongHighlight = (track: Track): Promise<SongHighlightResponse> => {
  if (track.source === "plugin") return Promise.resolve({ ok: true, data: null, sources: [] });
  const key = getSongHighlightKey(track);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    if (cached.expires > Date.now()) {
      cache.set(key, cached);
      return Promise.resolve(cached.value);
    }
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  if (inflight.size >= MAX_INFLIGHT)
    return Promise.resolve({ ok: false, error: "高潮查询繁忙", sources: [] });
  const task = queryHighlight(track)
    .then((result) => {
      if (result.ok && result.data && result.sources.every((source) => source.status !== "error")) {
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
        cache.set(key, { value: result, expires: Date.now() + CACHE_TTL_MS });
      }
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
};
