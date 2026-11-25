import type { AudioQuality, Track } from "@shared/types/player";
import type { JfjtSongMetadata } from "@shared/types/jfjt";
import type { QualityLevel } from "@/utils/quality";
import { isPlatform } from "@shared/types/platform";
import { streamingSourceForTrack } from "@shared/utils/streamingSource";
import { resolveByPlugin } from "@/services/audioSource";
import { resolveNeteaseDownloadUrl } from "@/apis/song/netease";
import { resolveQQMusicUrl } from "@/apis/song/qqmusic";
import { resolveKugouUrl } from "@/apis/song/kugou";

/** 下载源解析结果 */
export interface DownloadSource {
  url: string;
  /** 解析来源 */
  source?: "jfjt" | "official" | "plugin" | "streaming";
  /** 已知格式（flac/mp3 等），用于扩展名 */
  format?: string;
  /** 已知体积（字节） */
  size?: number;
  /** 接口声明的实际音质档位 */
  actualLevel?: QualityLevel;
  /** 接口声明的实际音质信息 */
  actualQuality?: AudioQuality;
  /** 可选补充元数据（仅用于缺失兜底） */
  metadata?: JfjtSongMetadata;
}

/**
 * 按下载音质解析歌曲下载地址
 * @param track - 要下载的歌曲
 * @param level - 下载音质档位
 * @param usePlaybackForDownload - 是否允许使用播放源下载
 * @returns 下载源；无法下载（VIP/试听/无插件/流媒体失败）返回 null
 */
export const resolveDownloadSource = async (
  track: Track,
  level: QualityLevel,
  usePlaybackForDownload: boolean,
): Promise<DownloadSource | null> => {
  // 流媒体
  if (track.source === "streaming") {
    try {
      return { url: streamingSourceForTrack(track) };
    } catch {
      return null;
    }
  }
  // 官方接口
  if (track.source === "netease") {
    try {
      const resolved = await resolveNeteaseDownloadUrl(track, level, usePlaybackForDownload);
      if (resolved) return resolved;
    } catch {
      // 官方失败回落插件
    }
  }
  // 官方播放直链
  if (track.source === "qqmusic") {
    const resolved = await resolveQQMusicUrl(track, level);
    if (resolved.available) return { url: resolved.url };
  }
  if (track.source === "kugou") {
    const resolved = await resolveKugouUrl(track, level);
    if (resolved.available) return { url: resolved.url };
  }
  // 其他播放源走插件
  if (isPlatform(track.source)) {
    const res = await resolveByPlugin(track, level);
    if (res.ok && !res.isTrial) return { url: res.url };
  }
  return null;
};
