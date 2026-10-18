/** 提供高潮标注的平台 */
export type SongHighlightPlatform = "netease" | "kugou";

/** 平台标注的高潮区间，时间统一为毫秒 */
export interface SongHighlightSegment {
  startMs: number;
  endMs?: number;
}

/** 当前歌曲可用的高潮标注 */
export interface SongHighlight {
  platform: SongHighlightPlatform;
  platformId: string;
  /** 是否通过歌曲元数据匹配到平台版本 */
  matched: boolean;
  segments: SongHighlightSegment[];
}

/** 成功但没有标注时返回 null，请求失败与无标注分别处理 */
export type SongHighlightResponse =
  { ok: true; data: SongHighlight | null } | { ok: false; error: string };
