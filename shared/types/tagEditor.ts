import type { Track } from "./player";
import type { LyricStorageData } from "./lyrics";

/** 本地文件可编辑标签 */
export interface TrackTags {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number;
  genre?: string;
  trackNumber?: number;
  discNumber?: number;
  /** 内嵌歌词纯文本 */
  lyrics?: string;
  lyricData?: LyricStorageData;
  /** 是否有内嵌封面 */
  hasCover: boolean;
}

/** 单曲标签编辑请求（undefined = 不修改；文本空串 / 数字 0 = 清除） */
export interface TagEditRequest {
  path: string;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number;
  genre?: string;
  trackNumber?: number;
  discNumber?: number;
  lyrics?: string;
  /** 与歌词原文一起保存的格式、翻译、音译和注音 */
  lyricData?: LyricStorageData;
  /** 新封面图片文件路径，undefined = 保留现有封面 */
  coverPath?: string;
  /** 新封面远程 URL（在线匹配回填），与 coverPath 互斥，下载失败时跳过封面只写文本 */
  coverUrl?: string;
}

/** 单曲写入结果 */
export interface TagWriteOutcome {
  path: string;
  success: boolean;
  error?: string;
  /** 写入成功后的最新 Track */
  track?: Track;
}
