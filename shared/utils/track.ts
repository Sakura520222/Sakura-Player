import type { Artist, Track } from "../types/player";

/**
 * 获取有效的歌手记录
 * @param artists - 歌手数组
 * @returns 过滤掉 name 为空的歌手记录
 */
export const getValidArtists = (artists?: Artist[]): Artist[] =>
  (artists ?? []).filter((artist) => artist.name.trim().length > 0);

/**
 * 格式化歌手名称。
 * @param artists - 歌手数组
 * @param separator - 分隔符，默认 " / "
 * @returns 拼接后的歌手名称字符串
 */
export const formatArtists = (artists?: Artist[], separator = " / "): string =>
  getValidArtists(artists)
    .map((artist) => artist.name.trim())
    .join(separator);

/**
 * 标识实际媒体和分轨，显示标签更新不改变播放身份
 * @param track - 当前媒体，空表示没有歌曲
 * @returns 仅供进程内比较的完整曲目标识
 */
export function getPlaybackTrackKey(track: Track | null): string {
  if (!track) return "";
  return JSON.stringify([
    track.source,
    track.id,
    track.serverId,
    track.originalId,
    track.serverRevision ?? 0,
    track.plugin?.pluginId,
    track.plugin?.source,
    track.source === "local" ? track.path : undefined,
    track.cueAudioPath,
    track.cueStartMs,
    track.cueEndMs,
  ]);
}
