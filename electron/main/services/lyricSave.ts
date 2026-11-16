import { dialog } from "electron";
import { readFile, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { store } from "@main/store";
import { coreLog } from "@main/utils/logger";
import { sanitizeSegment } from "@main/utils/filename";
import { readFileAutoEncoding } from "@main/utils/encoding";
import {
  LYRIC_COMPATIBLE_FORMATS,
  type LyricSaveFilesRequest,
  type LyricSaveFilesResult,
  type LyricPreviewFilesResult,
} from "@shared/types/lyrics";
import { parseCompatibleExport } from "@shared/utils/lyricCompatible";
import { getLocalTTMLSavePath, saveLocalTTML } from "./localLyricRepo";
import { replaceLyricFile, validateTtmlDocument, writeTtmlDocument } from "./lyricDocument";

let pendingSave: Promise<unknown> = Promise.resolve();

/**
 * 解析当前设置下的保存位置，在线或 CUE 歌曲由另存为对话框选择路径
 * @param request - 歌曲与用户选择的格式
 * @param extension - 需要写入的主文件扩展名
 * @returns 已知的目标路径，尚需选择时为空
 */
const getSavePath = async (
  request: LyricSaveFilesRequest,
  extension: string,
): Promise<string | undefined> => {
  const { track } = request;
  if (extension === "ttml" && !request.saveTtmlAs) return getLocalTTMLSavePath(track);
  if (track.source !== "local" || !track.path || track.cuePath) return undefined;
  if (!isAbsolute(track.path) || !(await stat(track.path)).isFile())
    throw new Error("本地音乐文件无效");
  const target = join(
    dirname(track.path),
    `${basename(track.path, extname(track.path))}.${extension}`,
  );
  if (target.toLowerCase() === track.path.toLowerCase()) throw new Error("歌词路径与音频路径相同");
  return target;
};

/**
 * 获取原文与辅助文件路径的稳定配对
 * @param path - 主歌词文件的路径
 * @returns 同一文件名下的两个辅助文件路径
 */
const companionPaths = (path: string) => {
  const stem = path.slice(0, -extname(path).length);
  return { translation: `${stem}.tr.lrc`, romanization: `${stem}.roma.lrc` };
};

/**
 * 单独验证每条兼容轨道，并检查副文件使用主文件的时间点
 * @param request - 同一歌曲的兼容文件内容
 * @returns 主文件的实际扩展名
 */
const validateCompatible = (request: LyricSaveFilesRequest): string => {
  const format = request.compatibleFormat ?? "lrc";
  if (!LYRIC_COMPATIBLE_FORMATS.includes(format)) throw new Error("不支持的歌词导出格式");
  const main = parseCompatibleExport(request.lrc!, format);
  const times = new Set(main.map((line) => line.startTime));
  for (const text of [request.translation, request.romanization]) {
    if (
      text !== undefined &&
      parseCompatibleExport(text, "lrc").some((line) => !times.has(line.startTime))
    )
      throw new Error("辅助歌词与原文时间点不匹配");
  }
  return format === "enhanced-lrc" ? "lrc" : format;
};

/**
 * 写入一组已校验的兼容歌词；任一文件写入失败时恢复已更新的文件
 * @param files - 原文和用户选择写入的辅助轨道
 */
export const writeCompatible = async (
  files: { path: string; content: string }[],
): Promise<void> => {
  const previous = await Promise.all(
    files.map(({ path }) =>
      readFile(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }),
    ),
  );
  let written = 0;
  try {
    for (const file of files) {
      await replaceLyricFile(file.path, file.content);
      written++;
    }
  } catch (error) {
    const restored = await Promise.allSettled(
      files
        .slice(0, written)
        .map(({ path }, index) =>
          previous[index] ? replaceLyricFile(path, previous[index]!) : unlink(path),
        ),
    );
    for (const state of restored)
      if (state.status === "rejected")
        throw new AggregateError([error, state.reason], "歌词写入失败，部分文件未能恢复");
    throw error;
  }
};

/**
 * 按序保存文件，避免两个窗口同时覆盖同一目标及其附件
 * @param request - 当前歌曲及待保存的歌词
 * @returns 每个独立导出目标的保存结果
 */
export const saveLyricFiles = (request: LyricSaveFilesRequest): Promise<LyricSaveFilesResult> => {
  const task = pendingSave.then(async () => {
    const result: LyricSaveFilesResult = {};
    for (const target of ["lrc", "ttml"] as const) {
      const content = request[target];
      if (content === undefined) continue;
      const useRepo = target === "ttml" && !request.saveTtmlAs;
      if (
        useRepo &&
        (!store.get("localLyric.enableLocalTTMLOverride") || !store.get("localLyric.repoDir"))
      )
        continue;
      try {
        const extension = target === "ttml" ? "ttml" : validateCompatible(request);
        if (target === "ttml") validateTtmlDocument(content, request.auxiliary);
        if (useRepo) {
          result.ttml = {
            status: "saved",
            path: await saveLocalTTML(request.track, content, request.auxiliary),
          };
          continue;
        }
        let filePath = await getSavePath(request, extension);
        if (!filePath) {
          const name = sanitizeSegment(
            `${request.track.title} - ${request.track.artists.map((artist) => artist.name).join(", ")}`,
          );
          const picked = await dialog.showSaveDialog({
            title: `保存 ${extension.toUpperCase()} 歌词`,
            defaultPath: `${name || "lyrics"}.${extension}`,
            filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
          });
          if (picked.canceled || !picked.filePath) {
            result[target] = { status: "canceled" };
            continue;
          }
          filePath =
            extname(picked.filePath).toLowerCase() === `.${extension}`
              ? picked.filePath
              : `${picked.filePath}.${extension}`;
        }
        if (target === "ttml") await writeTtmlDocument(filePath, content, request.auxiliary);
        else {
          const paths = companionPaths(filePath);
          if (/\.(?:tr|roma)\.lrc$/i.test(filePath))
            throw new Error("请为原文选择不带 .tr 或 .roma 后缀的文件名");
          const files = [{ path: filePath, content }];
          for (const lane of ["translation", "romanization"] as const) {
            if (request[lane] !== undefined)
              files.push({ path: paths[lane], content: request[lane] });
          }
          await writeCompatible(files);
          for (const lane of ["translation", "romanization"] as const) {
            if (request[lane] !== undefined) result[lane] = { status: "saved", path: paths[lane] };
          }
        }
        result[target] = { status: "saved", path: filePath };
      } catch (error) {
        coreLog.warn(`保存 ${target} 歌词失败`, error);
        result[target] = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return result;
  });
  pendingSave = task.catch(() => {});
  return task;
};

/**
 * 核对将写入的内容并读取当前文件，供保存前预览
 * @param request - 与实际保存一致的歌词与格式
 * @returns 现有文件内容、路径或需要另选目标的提示
 */
export const previewLyricFiles = async (
  request: LyricSaveFilesRequest,
): Promise<LyricPreviewFilesResult> => {
  const result: LyricPreviewFilesResult = {};
  for (const target of ["lrc", "ttml"] as const) {
    if (request[target] === undefined) continue;
    if (
      target === "ttml" &&
      !request.saveTtmlAs &&
      (!store.get("localLyric.enableLocalTTMLOverride") || !store.get("localLyric.repoDir"))
    )
      continue;
    const selected =
      target === "lrc"
        ? (["lrc", "translation", "romanization"] as const).filter(
            (key) => request[key] !== undefined,
          )
        : (["ttml"] as const);
    try {
      const extension = target === "ttml" ? "ttml" : validateCompatible(request);
      if (target === "ttml") validateTtmlDocument(request.ttml!, request.auxiliary);
      const mainPath = await getSavePath(request, extension);
      for (const key of selected) {
        if (!mainPath) {
          result[key] = { status: "ready", content: "", exists: false, needsDestination: true };
          continue;
        }
        const path =
          key === "translation" || key === "romanization"
            ? companionPaths(mainPath)[key]
            : mainPath;
        try {
          result[key] = {
            status: "ready",
            path,
            content: await readFileAutoEncoding(path),
            exists: true,
          };
        } catch (error) {
          result[key] =
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? { status: "ready", path, content: "", exists: false }
              : { status: "failed", error: error instanceof Error ? error.message : String(error) };
        }
      }
    } catch (error) {
      for (const key of selected)
        result[key] = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
    }
  }
  return result;
};
