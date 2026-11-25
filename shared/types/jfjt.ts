/** JFJT 第三方解析服务支持的音质档位 */
export const JFJT_LEVELS = [
  "standard",
  "exhigh",
  "lossless",
  "hires",
  "jyeffect",
  "sky",
  "jymaster",
] as const;

/** JFJT 单曲解析支持的音质参数 */
export type JfjtLevel = (typeof JFJT_LEVELS)[number];

/** JFJT 响应中可识别的音质档位（含兼容官方较高档位） */
export type JfjtParsedLevel = JfjtLevel | "higher";

/** JFJT 响应携带的可选补充元数据 */
export interface JfjtSongMetadata {
  /** 歌曲名称 */
  name?: string;
  /** 歌手名称（服务端原始拼接文本） */
  artistName?: string;
  /** 专辑名称 */
  albumName?: string;
  /** 封面地址（已校验为 HTTP/HTTPS） */
  cover?: string;
  /** 原文歌词 */
  lyric?: string;
  /** 翻译歌词 */
  tlyric?: string;
}

/** 校验通过的 JFJT 单曲解析数据 */
export interface JfjtSongData {
  /** 已校验为 HTTP/HTTPS 的音频直链 */
  url: string;
  /** 服务端返回的原始音质标识 */
  rawLevel?: string;
  /** 归一后的音质档位，无法识别时为 undefined */
  jfjtLevel?: JfjtParsedLevel;
  /** 服务端明确提供的文件格式（如 flac/mp3），缺失时不猜测 */
  format?: string;
  /** 解析后的文件体积（字节），缺失或无效时为 undefined */
  size?: number;
  /** 可选补充元数据，仅用于补齐缺失字段 */
  metadata?: JfjtSongMetadata;
}

/** 主进程 JFJT 解析通道返回结构 */
export type JfjtResolveResponse = { ok: true; data: JfjtSongData } | { ok: false; error: string };
