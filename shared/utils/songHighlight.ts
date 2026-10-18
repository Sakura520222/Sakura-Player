import type { SongHighlightSegment } from "../types/songHighlight";

/**
 * 校验平台毫秒时间轴，去重排序并限制到当前歌曲范围
 * @param segments - 平台返回的起止时间
 * @param durationMs - 当前歌曲时长，未知时传 0
 * @returns 有界的有效高潮区间
 */
export const normalizeHighlightSegments = (
  segments: { startMs: unknown; endMs?: unknown }[],
  durationMs: number,
): SongHighlightSegment[] => {
  const result: SongHighlightSegment[] = [];
  for (const segment of segments) {
    const start = segment.startMs;
    const end = segment.endMs;
    if ((typeof start !== "number" && typeof start !== "string") || String(start).trim() === "")
      continue;
    const startMs = Math.round(Number(start));
    if (!Number.isFinite(startMs) || startMs < 0 || (durationMs > 0 && startMs >= durationMs))
      continue;
    let endMs: number | undefined;
    if (end !== undefined && end !== null) {
      if ((typeof end !== "number" && typeof end !== "string") || String(end).trim() === "")
        continue;
      endMs = Math.round(Number(end));
      if (!Number.isFinite(endMs) || endMs <= startMs) continue;
      if (durationMs > 0) endMs = Math.min(endMs, durationMs);
    } else if (startMs === 0) {
      // 平台常用全零表示未标注，不能将其当作歌曲高潮
      continue;
    }
    if (result.some((item) => item.startMs === startMs)) continue;
    result.push({ startMs, ...(endMs !== undefined ? { endMs } : {}) });
  }
  return result.sort((a, b) => a.startMs - b.startMs).slice(0, 16);
};
