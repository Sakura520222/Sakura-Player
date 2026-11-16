import { parseLyric } from "lyric-kit";
import type { LyricInput, LyricLine, LyricMetadata } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { serializeTtmlLyrics } from "@shared/utils/lyricTtmlExport";
import { getRomanizationSpans } from "./romanization";

/**
 * 合并曲目信息及可复用的源歌词元数据
 * @param track - 当前播放歌曲
 * @param input - 保存所依据的原始歌词
 * @returns 歌词导出使用的元数据
 */
export const getLyricExportMetadata = (track: Track, input: LyricInput): LyricMetadata => ({
  ...parseLyric({ content: input.content, format: input.format }, { extractMetadata: true })
    .metadata,
  title: [track.title],
  artist: track.artists.map((artist) => artist.name),
  ...(track.album?.name ? { album: [track.album.name] } : {}),
});

/**
 * 导出包含原文、时间、翻译及音译的完整 TTML
 * @param track - 当前歌曲
 * @param lines - 当前完整歌词和逐字对齐
 * @param input - 原始歌词或可复用的 TTML 样式
 * @returns 经往返校验的 TTML 和必要的原词关联附件
 */
export const createLyricSaveContent = (track: Track, lines: LyricLine[], input: LyricInput) => {
  const source = getLyricExportMetadata(track, input);
  const original = input.format === "ttml" ? input.content : undefined;
  const complete = lines.map((line) => {
    const romanizationWords = getRomanizationSpans(line);
    return romanizationWords === line.romanizationWords ? line : { ...line, romanizationWords };
  });
  return serializeTtmlLyrics(track, complete, source, original);
};
