import { app } from "electron";
import path from "node:path";

/**
 * 获取随当前平台播放器发布的独立 Rust 工作进程，不查找系统可执行文件
 * @returns 当前安装或开发目录下的工作进程路径
 */
export const getAlignmentExecutable = (): string => {
  const filename = process.platform === "win32" ? "lyric-alignment.exe" : "lyric-alignment";
  return app.isPackaged
    ? path.join(process.resourcesPath, "native", filename)
    : path.join(app.getAppPath(), "native", "lyric-alignment", "bin", filename);
};

/**
 * 判断当前进程架构是否属于随播放器构建的六个平台
 * @returns 当前系统与进程架构是否受支持
 */
export const isAlignmentPlatformSupported = (): boolean =>
  ["win32", "darwin", "linux"].includes(process.platform) &&
  ["x64", "arm64"].includes(process.arch);
