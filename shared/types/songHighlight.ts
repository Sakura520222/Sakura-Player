/** 提供音乐段落标注的平台 */
export type SongHighlightPlatform = "netease" | "kugou";

/** 同一时间的副歌和高潮保留为独立的平台标注 */
export interface SongHighlightSegment {
  kind: "chorus" | "climax";
  platform: SongHighlightPlatform;
  platformId: string;
  /** 原平台 ID 直接命中或跨平台元数据匹配 */
  confidence: "exact-id" | "metadata";
  startMs: number;
  endMs?: number;
}

export interface SongHighlight {
  segments: SongHighlightSegment[];
}

/** 每个平台独立报告查询结果，部分失败时仍可使用其他标注 */
export interface SongHighlightSource {
  platform: SongHighlightPlatform;
  status: "available" | "empty" | "unmatched" | "error";
}

export type SongHighlightResponse = (
  { ok: true; data: SongHighlight | null } | { ok: false; error: string }
) & { sources: SongHighlightSource[] };
