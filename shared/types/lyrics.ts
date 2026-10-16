import type { Platform } from "./platform";
import type { Track } from "./player";
import type {
  LyricFormat,
  LyricInput,
  LyricLine as BaseLyricLine,
  LyricMetadata,
  LyricResult,
  LyricSpan,
  LyricWord,
} from "lyric-kit";

export type { LyricFormat, LyricInput, LyricMetadata, LyricResult, LyricSpan, LyricWord };

/** 保留与主歌词同一毫秒时间轴的辅助逐字轨道 */
export interface LyricLine extends BaseLyricLine {
  translationWords?: LyricSpan[];
  romanizationWords?: LyricSpan[];
}

/** 默认格式优先级 */
export const DEFAULT_LYRIC_FORMAT_ORDER: readonly LyricFormat[] = [
  "ttml",
  "lys",
  "qrc",
  "krc",
  "yrc",
  "lrc",
  "ass",
  "srt",
];

/** 歌词来源 */
export type LyricSource = "external" | "embedded" | "online";

/** 歌词数据 */
export type LyricData = {
  source: LyricSource;
  format: LyricFormat;
  /** 在线歌词所属平台，仅 source=online 时有值 */
  platform?: Platform;
} | null;

/** 原始歌词的格式及独立辅助轨道，主歌词原文单独写入标准歌词标签 */
export type LyricStorageData = Omit<LyricInput, "content" | "format"> & { format: LyricFormat };

/** 平台额外字段 */
export interface LyricMatchExtra {
  /** QM 的 mid */
  mid?: string;
}

/** 歌词匹配结果 */
export interface LyricMatchResult extends LyricInput {
  platform: Platform;
  /** 主歌词格式 */
  format: LyricFormat;
  /** 平台额外字段，netease/kugou 暂未使用 */
  extra?: LyricMatchExtra;
}

/** 歌词匹配 IPC 响应 */
export type LyricMatchResponse =
  { ok: true; data: LyricMatchResult | null } | { ok: false; error: string };

/** TTML 抓取 IPC 响应 */
export type LyricTTMLResponse = { ok: true; data: string | null } | { ok: false; error: string };

/** 歌词文件保存请求；TTML 仅在本地库已启用并配置目录时写入 */
export interface LyricSaveFilesRequest {
  track: Track;
  lrc?: string;
  ttml?: string;
}

/** 单个歌词文件的保存结果 */
export type LyricFileSaveOutcome =
  { status: "saved"; path: string } | { status: "canceled" } | { status: "failed"; error: string };

export interface LyricSaveFilesResult {
  lrc?: LyricFileSaveOutcome;
  ttml?: LyricFileSaveOutcome;
}

/** 文件预览只读取现有内容；另存为的目标在保存时选择 */
export type LyricFilePreviewOutcome =
  | { status: "ready"; content: string; exists: boolean; path?: string; needsDestination?: boolean }
  | { status: "failed"; error: string };

export interface LyricPreviewFilesResult {
  lrc?: LyricFilePreviewOutcome;
  ttml?: LyricFilePreviewOutcome;
}

/** 渲染端歌词匹配入口 */
export interface LyricsApi {
  /** 按 id 直取某平台歌词 */
  matchById: (platform: Platform, id: string) => Promise<LyricMatchResponse>;
  /** 按 Track 元数据在某平台模糊搜索歌词 */
  matchByQuery: (platform: Platform, track: Track) => Promise<LyricMatchResponse>;
  /** 抓取 AMLL TTML DB 的 TTML 歌词，仅 NCM/QM 适用 */
  fetchTTMLOverlay: (track: Track, platform: "netease" | "qqmusic") => Promise<LyricTTMLResponse>;
  /** 在本地 TTML 歌词库中按元信息匹配，命中返回 TTML 原文 */
  matchLocalTTML: (track: Track) => Promise<LyricTTMLResponse>;
  /** 弹出目录选择器，返回所选本地 TTML 歌词库目录 */
  pickLyricRepoDir: () => Promise<string | null>;
  /** 保存同名 LRC 或另存为，并按配置保存 TTML 到本地库 */
  saveFiles: (request: LyricSaveFilesRequest) => Promise<LyricSaveFilesResult>;
  /** 读取与实际保存相同目标的原有歌词，不选择路径或写入文件 */
  previewFiles: (request: LyricSaveFilesRequest) => Promise<LyricPreviewFilesResult>;
}
