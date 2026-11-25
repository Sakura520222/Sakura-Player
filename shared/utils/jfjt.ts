import type { Artist, Track } from "@shared/types/player";
import {
  JFJT_LEVELS,
  type JfjtLevel,
  type JfjtParsedLevel,
  type JfjtSongData,
  type JfjtSongMetadata,
} from "@shared/types/jfjt";

const JFJT_LEVEL_SET: ReadonlySet<string> = new Set(JFJT_LEVELS);

/** 允许的显式音频格式标识 */
const KNOWN_AUDIO_FORMATS: ReadonlySet<string> = new Set([
  "flac",
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "ape",
  "wv",
  "aiff",
]);

/** 常见音质标识（含英文代号与中文展示文案）到统一档位的映射 */
const LEVEL_ALIASES: Readonly<Record<string, JfjtParsedLevel>> = {
  standard: "standard",
  标准: "standard",
  标准音质: "standard",
  higher: "higher",
  较高: "higher",
  较高音质: "higher",
  exhigh: "exhigh",
  极高: "exhigh",
  极高音质: "exhigh",
  lossless: "lossless",
  无损: "lossless",
  无损音质: "lossless",
  hires: "hires",
  "hi-res": "hires",
  hires音质: "hires",
  "hi-res音质": "hires",
  jyeffect: "jyeffect",
  高清环绕声: "jyeffect",
  高清臻音: "jyeffect",
  sky: "sky",
  沉浸环绕声: "sky",
  jymaster: "jymaster",
  超清母带: "jymaster",
};

/** 体积单位换算表（按二进制字节计） */
const SIZE_UNIT_MULTIPLIERS: Readonly<Record<string, number>> = {
  b: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 * 1024,
  mib: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  gib: 1024 * 1024 * 1024,
};

/**
 * 判断未知值是否为普通对象记录
 * @param value - 待检查的值
 * @returns 是否为非数组对象
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * 提取非空裁剪字符串
 * @param value - 原始字段值
 * @returns 非空字符串，否则返回 undefined
 */
const readNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * 校验字符串是否为合法的 HTTP/HTTPS 地址
 * @param value - 待校验的地址值
 * @returns 是否为合法 HTTP(S) URL
 */
export const isValidHttpUrl = (value: unknown): value is string => {
  const text = readNonEmptyString(value);
  if (!text || /[\r\n\t]/.test(text)) return false;
  try {
    const parsed = new URL(text);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
};

/**
 * 校验并提取纯数字网易云歌曲 ID，拒绝任意 URL 或非法输入
 * @param id - 歌曲 ID
 * @returns 归一化后的纯数字 ID，非法时返回 null
 */
export const normalizeNeteaseSongId = (id: unknown): string | null => {
  if (typeof id !== "string" && typeof id !== "number") return null;
  const text = String(id).trim();
  return /^\d+$/.test(text) ? text : null;
};

/**
 * 判断音质参数是否属于 JFJT 允许的档位集合
 * @param value - 待校验的音质档位
 * @returns 是否为合法 JFJT 档位
 */
export const isValidJfjtLevel = (value: unknown): value is JfjtLevel =>
  typeof value === "string" && JFJT_LEVEL_SET.has(value);

/**
 * 解析 JFJT 返回的文件体积字段（兼容字节数与带单位字符串如 "25.43MB"）
 * @param value - 原始 size 字段
 * @returns 正整数字节数，缺失或无法解析时返回 undefined
 */
export const parseJfjtSize = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
  }
  const text = readNonEmptyString(value);
  if (!text) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const num = Number(text);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : undefined;
  }
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = SIZE_UNIT_MULTIPLIERS[match[2].toLowerCase()];
  if (!Number.isFinite(amount) || amount <= 0 || !multiplier) return undefined;
  const bytes = Math.round(amount * multiplier);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
};

/**
 * 归一化 JFJT 返回的音质档位字段
 * @param value - 原始 data.level 字段
 * @returns 归一化后的档位，无法识别时返回 undefined
 */
export const normalizeJfjtLevel = (value: unknown): JfjtParsedLevel | undefined => {
  const text = readNonEmptyString(value);
  if (!text) return undefined;
  const compact = text.toLowerCase().replace(/\s+/g, "");
  return LEVEL_ALIASES[compact];
};

/**
 * 归一化接口明确声明的音频文件格式，仅接受已知格式，不从音质档位猜测
 * @param value - 原始格式字段
 * @returns 小写格式扩展名（不含点），缺失或不可识别时返回 undefined
 */
export const normalizeJfjtFormat = (value: unknown): string | undefined => {
  const text = readNonEmptyString(value);
  if (!text) return undefined;
  const normalized = text.replace(/^\.+/, "").toLowerCase();
  return KNOWN_AUDIO_FORMATS.has(normalized) ? normalized : undefined;
};

/**
 * 校验并提取 JFJT `/Song_V1` JSON 响应中的有效数据
 * @param payload - 原始 JSON 响应体
 * @returns 校验通过的单曲解析结果，无效响应返回 null
 */
export const parseJfjtSongResponse = (payload: unknown): JfjtSongData | null => {
  if (!isRecord(payload)) return null;
  if (payload.status !== undefined && Number(payload.status) !== 200) return null;
  if (payload.code !== undefined && Number(payload.code) !== 200) return null;

  let record: Record<string, unknown>;
  if ("data" in payload) {
    if (!isRecord(payload.data)) return null;
    record = payload.data;
  } else {
    record = payload;
  }

  if (!isValidHttpUrl(record.url)) return null;
  const url = record.url.trim();

  const rawLevel = readNonEmptyString(record.level);
  const jfjtLevel = normalizeJfjtLevel(rawLevel);
  const size = parseJfjtSize(record.size);
  const format = normalizeJfjtFormat(record.type ?? record.format);

  const metadata: JfjtSongMetadata = {};
  const name = readNonEmptyString(record.name);
  const artistName = readNonEmptyString(record.ar_name);
  const albumName = readNonEmptyString(record.al_name);
  const cover = isValidHttpUrl(record.pic) ? record.pic.trim() : undefined;
  const lyric = readNonEmptyString(record.lyric);
  const tlyric = readNonEmptyString(record.tlyric);

  if (name) metadata.name = name;
  if (artistName) metadata.artistName = artistName;
  if (albumName) metadata.albumName = albumName;
  if (cover) metadata.cover = cover;
  if (lyric) metadata.lyric = lyric;
  if (tlyric) metadata.tlyric = tlyric;

  return {
    url,
    ...(rawLevel ? { rawLevel } : {}),
    ...(jfjtLevel ? { jfjtLevel } : {}),
    ...(format ? { format } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
};

/**
 * 将 JFJT 返回的歌手拼接字符串拆分为 Artist 列表
 * @param artistName - 原始歌手名文本
 * @returns 非空歌手列表
 */
const parseJfjtArtists = (artistName: string): Artist[] =>
  artistName
    .split(/\s*\/\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ id: "", name }));

/**
 * 仅在现有 Track 元数据缺失时用 JFJT 响应补齐，避免覆盖已有准确元数据
 * @param track - 现有歌曲信息
 * @param metadata - JFJT 返回的可选元数据
 * @returns 补齐缺失字段后的 Track，无变化时返回原对象
 */
export const mergeJfjtFallbackMetadata = (track: Track, metadata?: JfjtSongMetadata): Track => {
  if (!metadata) return track;

  let changed = false;
  let title = track.title;
  if (!title?.trim() && metadata.name) {
    title = metadata.name;
    changed = true;
  }

  let artists = track.artists;
  const hasArtists = artists.some((artist) => artist.name?.trim());
  if (!hasArtists && metadata.artistName) {
    const parsed = parseJfjtArtists(metadata.artistName);
    if (parsed.length > 0) {
      artists = parsed;
      changed = true;
    }
  }

  let album = track.album;
  if (!album?.name?.trim() && metadata.albumName) {
    album = {
      id: album?.id ?? "",
      name: metadata.albumName,
      cover: album?.cover ?? metadata.cover,
    };
    changed = true;
  }

  let cover = track.cover;
  if (!cover && metadata.cover) {
    cover = metadata.cover;
    changed = true;
  }

  let coverOriginal = track.coverOriginal;
  if (!coverOriginal && metadata.cover) {
    coverOriginal = metadata.cover;
    changed = true;
  }

  if (!changed) return track;
  return {
    ...track,
    title,
    artists,
    album,
    cover,
    coverOriginal,
  };
};
