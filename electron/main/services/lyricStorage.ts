import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_LYRIC_FORMAT_ORDER, type LyricStorageData } from "@shared/types/lyrics";

const format = z.enum(DEFAULT_LYRIC_FORMAT_ORDER);
const storageSchema = z.object({
  version: z.literal(1),
  contentHash: z.string(),
  format,
  translation: z.string().optional(),
  translationFormat: format.optional(),
  romaji: z.string().optional(),
  romajiFormat: format.optional(),
  kana: z.string().optional(),
});

/**
 * 标准歌词字段保留原文，附加字段保存完整输入所需的其他轨道
 * @param content - 不经转换的主歌词原文
 * @param data - 歌词格式及辅助轨道
 * @returns 写入附加标签的文本
 */
export const encodeLyricStorage = (content: string, data: LyricStorageData): string =>
  JSON.stringify(
    storageSchema.parse({
      ...data,
      version: 1,
      contentHash: createHash("sha256").update(content).digest("hex"),
    }),
  );

/**
 * 读取附加轨道；其他标签编辑器修改主歌词后不再套用旧的格式和翻译
 * @param content - 当前主歌词原文
 * @param stored - 读取到的附加标签
 * @returns 有效的格式及辅助轨道，旧文件或不匹配时为空
 */
export const decodeLyricStorage = (
  content: string | undefined,
  stored: string | undefined,
): LyricStorageData | undefined => {
  if (content === undefined || !stored) return undefined;
  try {
    const result = storageSchema.safeParse(JSON.parse(stored));
    if (!result.success) return undefined;
    const { version: _version, contentHash, ...data } = result.data;
    if (contentHash !== createHash("sha256").update(content).digest("hex")) return undefined;
    return data;
  } catch {
    return undefined;
  }
};
