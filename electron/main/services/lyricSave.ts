import { dialog } from "electron";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { writeFile } from "atomically";
import { store } from "@main/store";
import { coreLog } from "@main/utils/logger";
import { sanitizeSegment } from "@main/utils/filename";
import { getLocalTTMLSavePath, saveLocalTTML } from "@main/services/localLyricRepo";
import { readFileAutoEncoding } from "@main/utils/encoding";
import type {
  LyricSaveFilesRequest,
  LyricSaveFilesResult,
  LyricPreviewFilesResult,
} from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";

/**
 * 解析本地独立歌曲的同名 LRC 路径，在线歌曲和 CUE 由保存操作另选目标
 * @param track - 当前歌曲
 * @returns 可直接写入的 LRC 路径
 */
const getLocalLrcPath = async (track: Track): Promise<string | undefined> => {
  if (track.source !== "local" || !track.path || track.cuePath) return undefined;
  if (!isAbsolute(track.path) || !(await stat(track.path)).isFile()) {
    throw new Error("本地音乐文件无效");
  }
  return join(dirname(track.path), `${basename(track.path, extname(track.path))}.lrc`);
};

/**
 * 各目标独立保存，单项失败不阻止其他歌词文件写入
 * @param request - 当前歌曲及待保存的歌词
 * @returns 各文件的保存结果；未启用 TTML 库时不返回 TTML 项
 */
export const saveLyricFiles = async (
  request: LyricSaveFilesRequest,
): Promise<LyricSaveFilesResult> => {
  const { track, lrc, ttml } = request;
  const result: LyricSaveFilesResult = {};
  if (lrc !== undefined) {
    try {
      if (!lrc.trim()) throw new Error("没有可保存的歌词");
      let filePath = await getLocalLrcPath(track);
      if (!filePath) {
        const name = sanitizeSegment(
          `${track.title} - ${track.artists.map((artist) => artist.name).join(", ")}`,
        );
        const picked = await dialog.showSaveDialog({
          title: "保存 LRC 歌词",
          defaultPath: `${name || "lyrics"}.lrc`,
          filters: [{ name: "LRC", extensions: ["lrc"] }],
        });
        if (!picked.canceled && picked.filePath) {
          filePath = /\.lrc$/i.test(picked.filePath) ? picked.filePath : `${picked.filePath}.lrc`;
        }
      }
      if (filePath) {
        await writeFile(filePath, lrc, "utf8");
        result.lrc = { status: "saved", path: filePath };
      } else {
        result.lrc = { status: "canceled" };
      }
    } catch (error) {
      coreLog.warn("保存 LRC 歌词失败:", error);
      result.lrc = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (
    ttml !== undefined &&
    store.get("localLyric.enableLocalTTMLOverride") &&
    store.get("localLyric.repoDir")
  ) {
    try {
      const filePath = await saveLocalTTML(track, ttml);
      result.ttml = { status: "saved", path: filePath };
    } catch (error) {
      coreLog.warn("保存本地 TTML 歌词失败:", error);
      result.ttml = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return result;
};

/**
 * 读取实际保存目标的原文，各目标读取失败时独立报告
 * @param request - 与保存操作相同的歌曲及已选文件内容
 * @returns 原文、路径或目标选择提示
 */
export const previewLyricFiles = async (
  request: LyricSaveFilesRequest,
): Promise<LyricPreviewFilesResult> => {
  const result: LyricPreviewFilesResult = {};
  for (const target of ["lrc", "ttml"] as const) {
    const content = request[target];
    if (content === undefined) continue;
    if (
      target === "ttml" &&
      (!store.get("localLyric.enableLocalTTMLOverride") || !store.get("localLyric.repoDir"))
    )
      continue;
    try {
      if (!content.trim()) throw new Error("没有可保存的歌词");
      const path =
        target === "lrc"
          ? await getLocalLrcPath(request.track)
          : await getLocalTTMLSavePath(request.track);
      if (!path) {
        result[target] = { status: "ready", content: "", exists: false, needsDestination: true };
        continue;
      }
      try {
        const content = await readFileAutoEncoding(path);
        result[target] = { status: "ready", path, content, exists: true };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        result[target] = { status: "ready", path, content: "", exists: false };
      }
    } catch (error) {
      result[target] = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return result;
};
