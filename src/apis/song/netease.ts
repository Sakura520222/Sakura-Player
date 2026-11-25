import type { AudioQuality, Track } from "@shared/types/player";
import type {
  JfjtLevel,
  JfjtParsedLevel,
  JfjtSongData,
  JfjtSongMetadata,
} from "@shared/types/jfjt";
import { ErrorCode } from "@shared/types/errors";
import { isValidHttpUrl, normalizeNeteaseSongId } from "@shared/utils/jfjt";
import type { QualityLevel } from "@/utils/quality";
import { netease as neteaseApi, neteaseCall } from "@/apis/netease";
import { isExplicitNeteaseAuthFailure } from "@/apis/neteaseAuth";
import { songsToTracks } from "@/utils/format/netease";

/**
 * 按 ID 批量取歌曲详情
 * @param ids - 平台 songId 列表
 * @returns 与传入 ids 对应的 Track 列表
 */
export const songsByIds = async (ids: Array<string | number>): Promise<Track[]> => {
  const cleaned = ids.map((v) => String(v).trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const body = await neteaseApi.song_detail({ ids: cleaned.join(",") });
  return songsToTracks(body?.songs);
};

/** 项目音质档位 → 官方 song/url v1 的 level 参数 */
const NETEASE_LEVEL: Record<QualityLevel, string> = {
  lq: "standard",
  sq: "higher",
  hq: "exhigh",
  lossless: "lossless",
  "hi-res": "hires",
};

/** 项目音质档位 → JFJT 实际支持的 level 参数（无 192 kbps 档位，sq 降级至 standard） */
export const JFJT_LEVEL_MAP: Record<QualityLevel, JfjtLevel> = {
  lq: "standard",
  sq: "standard",
  hq: "exhigh",
  lossless: "lossless",
  "hi-res": "hires",
};

/** 网易云音源解析来源 */
export type NeteaseResolveSource = "jfjt" | "official";

/**
 * 将应用音质档位映射到 JFJT 支持的请求档位
 * @param level - 应用音质档位
 * @returns JFJT 支持的 level 参数
 */
export const mapQualityToJfjtLevel = (level: QualityLevel): JfjtLevel => JFJT_LEVEL_MAP[level];

/**
 * 将 JFJT 返回的实际档位映射为应用音质档位，未识别时不虚报
 * @param level - 归一化后的 JFJT 实际档位
 * @returns 对应的应用音质档位，未知时返回 undefined
 */
export const jfjtLevelToQualityLevel = (
  level: JfjtParsedLevel | undefined,
): QualityLevel | undefined => {
  switch (level) {
    case "standard":
      return "lq";
    case "higher":
      return "sq";
    case "exhigh":
      return "hq";
    case "lossless":
      return "lossless";
    case "hires":
      return "hi-res";
    default:
      return undefined;
  }
};

/**
 * 按 JFJT 返回的实际档位构造展示用音质信息，仅用于解码探测前或下载列表真实展示
 * @param level - 归一化后的 JFJT 实际档位
 * @returns 对应的 AudioQuality，未知时返回 undefined
 */
export const jfjtLevelToAudioQuality = (
  level: JfjtParsedLevel | undefined,
): AudioQuality | undefined => {
  const declaredLevel = jfjtLevelToQualityLevel(level);
  if (!declaredLevel) return undefined;
  return {
    declaredLevel,
    codec: "unknown",
    sampleRate: 0,
    channels: 0,
    bitsPerSample: 0,
    bitRate: 0,
  };
};

export type NeteasePlayUrlResult =
  | {
      available: true;
      url: string;
      isTrial: boolean;
      source?: NeteaseResolveSource;
      actualLevel?: QualityLevel;
      actualQuality?: AudioQuality;
      rawLevel?: string;
      metadata?: JfjtSongMetadata;
    }
  | { available: false; errorCode: ErrorCode };

export interface NeteaseSessionRecovery {
  /** 发起请求前是否处于登录状态 */
  authenticated: boolean;
  /** 实时校验登录状态 */
  validate: () => Promise<boolean>;
}

/** 单曲播放解析控制选项 */
export interface NeteaseResolveOptions {
  /** 跳过 JFJT 第三方解析，直接回落官方接口 */
  skipJfjt?: boolean;
}

/**
 * 通过主进程受控通道调用 JFJT 解析网易云单曲
 * @param track - 待解析歌曲（仅接受纯数字 ID，云盘私有曲目跳过）
 * @param songLevel - 应用音质档位
 * @returns 校验通过的 JFJT 数据，失败或不可用时返回 null
 */
export const fetchNeteaseJfjtSong = async (
  track: Track,
  songLevel: QualityLevel,
): Promise<JfjtSongData | null> => {
  if (track.cloud) return null;
  const songId = normalizeNeteaseSongId(track.id);
  if (!songId) return null;
  const resolveJfjt = window.api?.apis?.resolveJfjtSong;
  if (typeof resolveJfjt !== "function") return null;
  try {
    const res = await resolveJfjt(songId, mapQualityToJfjtLevel(songLevel));
    if (!res?.ok || !res.data || !isValidHttpUrl(res.data.url)) return null;
    return res.data;
  } catch {
    return null;
  }
};

/**
 * 分类官方播放地址响应
 * @param item - song/url 返回的单曲数据
 * @returns 可播放地址或明确的不可播放原因
 */
export const classifyNeteasePlayUrl = (item: unknown): NeteasePlayUrlResult => {
  if (!item || typeof item !== "object") {
    return { available: false, errorCode: ErrorCode.NETEASE_UNAVAILABLE };
  }
  const data = item as { url?: unknown; freeTrialInfo?: unknown; fee?: unknown };
  if (typeof data.url === "string" && data.url) {
    return {
      available: true,
      url: data.url,
      isTrial: data.freeTrialInfo != null,
      source: "official",
    };
  }
  const fee = Number(data.fee);
  if (fee === 1 || fee === 4) {
    return { available: false, errorCode: ErrorCode.NETEASE_VIP_REQUIRED };
  }
  return { available: false, errorCode: ErrorCode.NETEASE_UNAVAILABLE };
};

/**
 * 解析 Track 的播放 URL（默认优先尝试 JFJT，失败或无效时回落官方 NCM 解析）
 * @param track - track.id 为云端 songId
 * @param songLevel - 音质偏好；实际可用级别取决于解析源与账号权限
 * @param recovery - 登录失效时的确认与恢复方法
 * @param options - 解析控制项
 * @returns 播放地址解析结果
 */
export const resolveNeteaseUrl = async (
  track: Track,
  songLevel: QualityLevel,
  recovery?: NeteaseSessionRecovery,
  options?: NeteaseResolveOptions,
): Promise<NeteasePlayUrlResult> => {
  if (!options?.skipJfjt) {
    const jfjt = await fetchNeteaseJfjtSong(track, songLevel);
    if (jfjt) {
      const actualLevel = jfjtLevelToQualityLevel(jfjt.jfjtLevel);
      const actualQuality = jfjtLevelToAudioQuality(jfjt.jfjtLevel);
      return {
        available: true,
        url: jfjt.url,
        isTrial: false,
        source: "jfjt",
        ...(actualLevel ? { actualLevel } : {}),
        ...(actualQuality ? { actualQuality } : {}),
        ...(jfjt.rawLevel ? { rawLevel: jfjt.rawLevel } : {}),
        ...(jfjt.metadata ? { metadata: jfjt.metadata } : {}),
      };
    }
  }

  const request = async (): Promise<NeteasePlayUrlResult> => {
    const body = await neteaseCall<{ data?: unknown[] }>(
      "song_url",
      { id: track.id, level: NETEASE_LEVEL[songLevel] },
      { notifyAuthFailure: false },
    );
    return classifyNeteasePlayUrl(body?.data?.[0]);
  };

  let result: NeteasePlayUrlResult | null = null;
  let authFailure = false;
  try {
    result = await request();
  } catch (err) {
    const failure = err as { status?: number; body?: unknown; message?: string };
    if (!recovery || !isExplicitNeteaseAuthFailure(failure)) throw err;
    authFailure = true;
  }

  const shouldValidate = authFailure || (recovery?.authenticated && !result?.available);
  if (!recovery || !shouldValidate) return result!;

  const stillAuthenticated = await recovery.validate();
  if (!authFailure && stillAuthenticated) return result!;

  try {
    result = await request();
  } catch (err) {
    if (!stillAuthenticated && recovery.authenticated) {
      return { available: false, errorCode: ErrorCode.NETEASE_LOGIN_EXPIRED };
    }
    throw err;
  }
  if (!stillAuthenticated && recovery.authenticated && !result.available) {
    return { available: false, errorCode: ErrorCode.NETEASE_LOGIN_EXPIRED };
  }
  return result;
};

/** 下载源（带格式、体积与来源信息） */
export interface NeteaseDownloadSource {
  url: string;
  /** 解析来源 */
  source?: NeteaseResolveSource;
  /** 文件格式（flac/mp3 等），缺失时不猜测 */
  format?: string;
  /** 体积（字节） */
  size?: number;
  /** 接口返回的实际音质档位 */
  actualLevel?: QualityLevel;
  /** 接口返回的实际音质信息 */
  actualQuality?: AudioQuality;
  /** 服务端原始音质字段 */
  rawLevel?: string;
  /** 可选补充元数据（仅用于缺失兜底） */
  metadata?: JfjtSongMetadata;
}

/**
 * 官方下载接口（客户端下载，占用每日下载次数）；data 为单对象
 * @param id - 歌曲 ID
 * @param level - 官方音质参数
 * @returns 下载源，不可用时返回 null
 */
const fetchNeteaseDownloadSource = async (
  id: string,
  level: string,
): Promise<NeteaseDownloadSource | null> => {
  try {
    const body = await neteaseApi.song_download_url({ id, level });
    const item = body?.data;
    if (!item?.url) return null;
    return { url: item.url, source: "official", format: item.type, size: item.size };
  } catch {
    return null;
  }
};

/**
 * 播放接口（不占用下载次数）；data 为数组、可能是试听片段
 * @param id - 歌曲 ID
 * @param level - 官方音质参数
 * @returns 下载源，试听或不可用时返回 null
 */
const fetchNeteasePlaySource = async (
  id: string,
  level: string,
): Promise<NeteaseDownloadSource | null> => {
  try {
    const body = await neteaseApi.song_url({ id, level });
    const item = body?.data?.[0];
    if (!item?.url || item.freeTrialInfo) return null;
    return { url: item.url, source: "official", format: item.type, size: item.size };
  } catch {
    return null;
  }
};

/**
 * 解析 Track 的下载源
 * 优先尝试 JFJT 直链，失败后回落官方链路：
 * 默认先尝试官方下载接口再回落播放接口；「模拟播放下载」开启时只回落播放接口，不占用每日下载次数
 * @param track - track.id 为 songId
 * @param songLevel - 下载音质
 * @param usePlayback - 模拟播放下载：回落官方时跳过下载接口、直接用播放接口
 * @param skipJfjt - 第三方直链失效后跳过该来源
 * @returns 下载源（带格式、体积与实际音质信息）；试听 / 无版权返回 null
 */
export const resolveNeteaseDownloadUrl = async (
  track: Track,
  songLevel: QualityLevel,
  usePlayback = false,
  skipJfjt = false,
): Promise<NeteaseDownloadSource | null> => {
  const jfjt = skipJfjt ? null : await fetchNeteaseJfjtSong(track, songLevel);
  if (jfjt) {
    const actualLevel = jfjtLevelToQualityLevel(jfjt.jfjtLevel);
    const actualQuality = jfjtLevelToAudioQuality(jfjt.jfjtLevel);
    return {
      url: jfjt.url,
      source: "jfjt",
      ...(jfjt.format ? { format: jfjt.format } : {}),
      ...(jfjt.size !== undefined ? { size: jfjt.size } : {}),
      ...(actualLevel ? { actualLevel } : {}),
      ...(actualQuality ? { actualQuality } : {}),
      ...(jfjt.rawLevel ? { rawLevel: jfjt.rawLevel } : {}),
      ...(jfjt.metadata ? { metadata: jfjt.metadata } : {}),
    };
  }

  const level = NETEASE_LEVEL[songLevel];
  if (!usePlayback) {
    const downloaded = await fetchNeteaseDownloadSource(track.id, level);
    if (downloaded) return downloaded;
  }
  return fetchNeteasePlaySource(track.id, level);
};
