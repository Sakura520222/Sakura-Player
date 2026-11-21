import { dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { writeFile } from "atomically";
import { getBackgroundsDir } from "@main/utils/config";
import { toCacheUrl } from "@main/utils/protocol";
import { systemLog } from "@main/utils/logger";

/** 允许的图片扩展名 */
const allowedExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);

/** 图片体积上限：30MB */
const MAX_BG_SIZE = 30 * 1024 * 1024;

/**
 * 解析主题自己的背景目录，Classic 沿用旧缓存位置
 * @param themeId - 稳定主题 ID
 * @returns 已校验的背景目录
 */
const getThemeBackgroundDir = (themeId: unknown): string | undefined => {
  if (typeof themeId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(themeId)) return;
  const root = getBackgroundsDir();
  return themeId === "classic" ? root : path.join(root, `theme-${themeId}`);
};

/**
 * 仅回收该目录中由选图功能生成的旧缓存
 * @param dir - 主题缓存目录
 * @param keep - 需要保留的新文件名
 */
const pruneThemeBackgrounds = async (dir: string, keep?: string): Promise<void> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name !== keep &&
            /^[0-9a-f]{16}\.[a-z]+$/.test(entry.name) &&
            allowedExt.has(path.extname(entry.name)),
        )
        .map(({ name }) => fs.rm(path.join(dir, name), { force: true })),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT")
      systemLog.error("[theme] pruneThemeBackgrounds failed", err);
  }
};

/**
 * 注册主题相关的 IPC
 */
export const registerThemeIpc = (): void => {
  let cacheMutation = Promise.resolve();

  /**
   * 串行提交磁盘更新，防止尚未完成的替换清理掉下一张图片
   * @param update - 本次缓存写入或清理
   */
  const updateCache = <T>(update: () => Promise<T>): Promise<T> => {
    const result = cacheMutation.then(update);
    cacheMutation = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  /**
   * 选择背景图并更新对应主题的缓存
   * @param themeId - 发起选图的主题
   * @returns 背景图缓存地址，取消或失败时为 null
   */
  ipcMain.handle(
    "theme:pickBackgroundImage",
    async (_, themeId: unknown): Promise<string | null> => {
      const dir = getThemeBackgroundDir(themeId);
      if (!dir) return null;
      try {
        const result = await dialog.showOpenDialog({
          title: "选择背景图片",
          properties: ["openFile"],
          filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"] }],
        });
        if (result.canceled) return null;
        const src = result.filePaths[0];
        if (!src) return null;
        const ext = path.extname(src).toLowerCase();
        if (!allowedExt.has(ext)) return null;
        // 体积校验
        const stat = await fs.stat(src);
        if (stat.size > MAX_BG_SIZE) {
          systemLog.warn(
            `[theme] background image too large: ${stat.size} bytes (max ${MAX_BG_SIZE})`,
          );
          return null;
        }
        const data = await fs.readFile(src);
        // 内容 hash 作为文件名
        const hash = createHash("sha1").update(data).digest("hex").slice(0, 16);
        const filename = `${hash}${ext}`;
        const dest = path.join(dir, filename);
        await updateCache(async () => {
          await fs.mkdir(dir, { recursive: true });
          await writeFile(dest, data);
          await pruneThemeBackgrounds(dir, filename);
        });
        return toCacheUrl(dest) ?? null;
      } catch (err) {
        systemLog.error("[theme] pickBackgroundImage failed", err);
        return null;
      }
    },
  );

  /**
   * 清理当前主题的背景图片
   * @param themeId - 要清理的主题
   */
  ipcMain.handle("theme:clearBackgroundImages", async (_, themeId: unknown): Promise<void> => {
    const dir = getThemeBackgroundDir(themeId);
    if (dir) await updateCache(() => pruneThemeBackgrounds(dir));
  });
};
