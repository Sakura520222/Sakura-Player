/**
 * 下载地址/歌词即时解析服务
 *
 * 批量下载整批入队后，主进程在轮到某任务且缺少 URL 时广播 download:resolve，
 * 这里解析 URL 与歌词后回传。解析请求因此保持一次一首，避免集中请求触发服务端风控。
 */
import type { DownloadResolution, DownloadResolvePayload } from "@shared/types/download";
import i18n from "@/i18n";
import { resolveDownloadSource } from "@/services/download/source";
import { resolveDownloadLyric } from "@/services/download/lyric";
import { parseDownloadLyrics } from "@/utils/lyric/serialize";
import { createLyricSaveContent, getLyricExportMetadata } from "@/utils/lyric/save";
import { useMediaStore } from "@/stores/media";
import { serializeCompatibleLyrics } from "@shared/utils/lyricCompatible";
import { toast } from "@/composables/useToast";

/** 解析单个任务的 URL 与歌词 */
const resolvePayload = async (payload: DownloadResolvePayload): Promise<DownloadResolution> => {
  const source = await resolveDownloadSource(
    payload.track,
    payload.qualityLevel,
    payload.usePlaybackForDownload,
  );
  if (!source) throw new Error("no download source");
  const { tagOptions } = payload;
  const resolution: DownloadResolution = {
    url: source.url,
    declaredFormat: source.format,
    declaredSize: source.size,
  };
  if (tagOptions.embedLyric || tagOptions.writeLrc || tagOptions.saveTtml) {
    const media = useMediaStore();
    const sameTrack =
      !media.lyricLoading &&
      media.track?.id === payload.track.id &&
      media.track.source === payload.track.source &&
      media.track.serverId === payload.track.serverId &&
      media.track.serverRevision === payload.track.serverRevision;
    const active =
      sameTrack && media.lyricFormat && media.lyricContent && media.parsedLyric.length
        ? { ...media.lyricContent, format: media.lyricFormat }
        : null;
    const lyric = active || (await resolveDownloadLyric(payload.track));
    if (lyric) {
      const lines = active ? media.getLyricExportLines() : parseDownloadLyrics(lyric);
      if (tagOptions.embedLyric || tagOptions.writeLrc) {
        try {
          const exported = serializeCompatibleLyrics(
            lines,
            payload.lyricFileFormat,
            getLyricExportMetadata(payload.track, lyric),
          );
          resolution.lyricText = exported.lrc;
          resolution.lyricTranslation = exported.translation;
          resolution.lyricRomanization = exported.romanization;
        } catch {
          toast.warning(
            i18n.global.t("download.lyricExportFailed", {
              title: payload.track.title,
              format: payload.lyricFileFormat.toUpperCase(),
            }),
          );
        }
      }
      if (tagOptions.saveTtml) {
        try {
          const exported = createLyricSaveContent(payload.track, lines, lyric);
          resolution.ttmlText = exported.ttml;
          resolution.ttmlAuxiliary = exported.auxiliary;
        } catch {
          toast.warning(
            i18n.global.t("download.lyricExportFailed", {
              title: payload.track.title,
              format: "TTML",
            }),
          );
        }
      }
    }
  }
  return resolution;
};

/** 注册解析请求监听 */
export const initDownloadResolver = (): (() => void) =>
  window.api.download.onResolve((payload) => {
    resolvePayload(payload)
      .then((res) => window.api.download.submitResolution(payload.taskId, res))
      .catch(() => {
        toast.error(i18n.global.t("download.resolveFailed", { title: payload.track.title }));
        void window.api.download.failResolution(payload.taskId);
      });
  });
