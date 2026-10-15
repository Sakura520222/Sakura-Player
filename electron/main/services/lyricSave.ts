import { dialog } from "electron";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { writeFile } from "atomically";
import { store } from "@main/store";
import { coreLog } from "@main/utils/logger";
import { sanitizeSegment } from "@main/utils/filename";
import { saveLocalTTML } from "@main/services/localLyricRepo";
import type { LyricSaveFilesRequest, LyricSaveFilesResult } from "@shared/types/lyrics";

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
      let filePath: string | undefined;
      if (track.source === "local" && track.path && !track.cuePath) {
        if (!isAbsolute(track.path) || !(await stat(track.path)).isFile()) {
          throw new Error("本地音乐文件无效");
        }
        filePath = join(dirname(track.path), `${basename(track.path, extname(track.path))}.lrc`);
      } else {
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
