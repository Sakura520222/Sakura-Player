import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { LyricAuxiliaryData, LyricInput } from "@shared/types/lyrics";
import { AUXILIARY_TRACKS } from "@shared/utils/lyricAuxiliary";
import { parseExportTtml } from "@shared/utils/lyricTtml";
import { readFileAutoEncoding } from "@main/utils/encoding";
import { decodeLyricStorage, encodeLyricStorage } from "./lyricStorage";

/**
 * 在同目录写完临时文件后原子替换目标，写入失败时保留现有歌词
 * @param path - 已确定的目标文件位置
 * @param data - 已校验的正文或恢复用原文件字节
 */
export const replaceLyricFile = async (path: string, data: string | Buffer): Promise<void> => {
  const temporary = join(dirname(path), `.lyrics-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: "wx", flush: true });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
};

/**
 * 读取同名的可选附件，文件不存在时允许单独使用原词
 * @param path - 附件路径
 * @returns 解码结果或 undefined
 */
const readOptional = async (path: string): Promise<string | undefined> => {
  try {
    return await readFileAutoEncoding(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
};

/**
 * 沿用媒体标签的内容校验读取 TTML 原词关联，兼容带有前一版本记录的文件
 * @param content - TTML 文件正文
 * @param attachment - 同名 Sakura 关联文件
 * @returns 匹配正文的辅助轨道数据
 */
const decodeAttachment = (content: string, attachment: string | undefined) => {
  if (!attachment) return undefined;
  try {
    const versions: unknown = JSON.parse(attachment);
    if (!Array.isArray(versions)) return undefined;
    for (const entry of versions.slice(0, 2)) {
      if (typeof entry !== "string") continue;
      const data = decodeLyricStorage(content, entry);
      if (data?.format === "ttml") return data;
    }
  } catch {
    // 编辑器写坏附件时仍可独立读取 TTML 中的语言轨道
  }
  return undefined;
};

/**
 * 校验通用 TTML 及逐字关联附件与正文的行、词、文本和时间一致
 * @param content - TTML 歌词
 * @param auxiliary - 需与正文一起保存的原词关联
 * @returns 已校验并绑定正文摘要的附件数据
 */
export const validateTtmlDocument = (
  content: string,
  auxiliary?: LyricAuxiliaryData,
): string | undefined => {
  const { lines } = parseExportTtml(content);
  if (!auxiliary) return undefined;
  const encoded = encodeLyricStorage(content, { format: "ttml", auxiliary });
  for (const [key, text, words] of AUXILIARY_TRACKS) {
    const rows = auxiliary[key];
    if (!rows) continue;
    if (
      rows.length !== lines.length ||
      rows.some((row, index) => {
        const line = lines[index];
        if (
          row.text.replace(/\s+/g, " ").trim() !== line[text].replace(/\s+/g, " ").trim() ||
          row.wordCount !== line.words.length
        )
          return true;
        return (
          JSON.stringify(
            row.words?.map(({ word, startTime, endTime }) => ({ word, startTime, endTime })) ?? [],
          ) !== JSON.stringify(line[words] ?? [])
        );
      })
    )
      throw new Error("TTML 原词关联与歌词正文不一致");
  }
  return encoded;
};

/**
 * 原子替换 TTML 正文，附件在替换前同时保留前一版本以支持失败重试
 * @param path - TTML 文件路径
 * @param content - 已序列化的 TTML 歌词
 * @param auxiliary - 可选的原词关联
 */
export const writeTtmlDocument = async (
  path: string,
  content: string,
  auxiliary?: LyricAuxiliaryData,
): Promise<void> => {
  const next = validateTtmlDocument(content, auxiliary);
  const attachment = `${path}.sakura.json`;
  const previous = await readOptional(attachment);
  if (!next && previous === undefined) {
    await replaceLyricFile(path, content);
    return;
  }
  const oldContent = await readOptional(path);
  const old = oldContent && decodeAttachment(oldContent, previous);
  await replaceLyricFile(
    attachment,
    JSON.stringify([
      next ?? encodeLyricStorage(content, { format: "ttml" }),
      ...(old && oldContent !== content ? [encodeLyricStorage(oldContent, old)] : []),
    ]),
  );
  if (oldContent === content) return;
  try {
    await replaceLyricFile(path, content);
  } catch (error) {
    try {
      if (previous === undefined) await unlink(attachment);
      else await replaceLyricFile(attachment, previous);
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], "TTML 写入失败，关联文件未能恢复");
    }
    throw error;
  }
};

/**
 * 读取外部歌词及其配对的辅助文件，优先保留 TTML 自身的语言轨道
 * @param path - 通过歌词扩展名筛选的主文件路径
 * @returns 供播放解析的完整输入
 */
export const readLyricDocument = async (path: string): Promise<LyricInput> => {
  const content = await readFileAutoEncoding(path);
  const extension = extname(path);
  if (extension.toLowerCase() === ".ttml") {
    const stored = await readFile(`${path}.sakura.json`, "utf8").catch(() => undefined);
    return { content, auxiliary: decodeAttachment(content, stored)?.auxiliary };
  }
  const stem = path.slice(0, -extension.length);
  const [translation, romaji] = await Promise.all([
    readOptional(`${stem}.tr.lrc`).catch(() => undefined),
    readOptional(`${stem}.roma.lrc`).catch(() => undefined),
  ]);
  return {
    content,
    translation,
    translationFormat: translation ? "lrc" : undefined,
    romaji,
    romajiFormat: romaji ? "lrc" : undefined,
  };
};
