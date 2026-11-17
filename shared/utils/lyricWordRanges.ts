import type { LyricWord, RomanizationSpan } from "../types/lyrics";

/**
 * 按当前主歌词的真实边界恢复辅助字词关联，拒绝旧时间覆盖和歧义分组
 * @param words - 当前主歌词字词
 * @param parts - 辅助片段及可选的原词范围
 * @returns 唯一且完整的关联；仅覆盖整行时间不视为逐字对齐
 */
export const resolveTimedWordRanges = (
  words: readonly LyricWord[],
  parts: readonly RomanizationSpan[],
): RomanizationSpan[] | undefined => {
  if (!parts.length || parts.some((part) => !part.word.trim())) return undefined;
  const source = words.flatMap((word, index) => (word.word.trim() ? [{ word, index }] : []));
  if (!source.length) return undefined;
  const explicit = parts.some((part) => part.from !== undefined || part.to !== undefined);
  if (!explicit && parts.length === 1 && source.length > 1) return undefined;
  const memo = new Map<string, { ranges: RomanizationSpan[]; count: number }>();

  /**
   * 只接受完整且唯一的连续分组，避免同刻字词在重载时被任意拆配
   * @param position - 当前音译片段下标
   * @param cursor - 下一个尚未覆盖的有效原词位置
   * @returns 完整分组及至多两个候选的数量
   */
  const resolve = (
    position: number,
    cursor: number,
  ): { ranges: RomanizationSpan[]; count: number } => {
    if (position === parts.length) return { ranges: [], count: cursor === source.length ? 1 : 0 };
    const key = `${position}:${cursor}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const part = parts[position];
    const result = { ranges: [] as RomanizationSpan[], count: 0 };
    let startTime = Infinity;
    let endTime = -Infinity;
    for (let end = cursor; end <= source.length - (parts.length - position); end++) {
      startTime = Math.min(startTime, source[end].word.startTime);
      endTime = Math.max(endTime, source[end].word.endTime);
      if (startTime < part.startTime || endTime > part.endTime) break;
      const from = source[cursor].index;
      const to = source[end].index;
      if (
        startTime !== part.startTime ||
        endTime !== part.endTime ||
        (explicit && (from !== (part.from ?? from) || to !== (part.to ?? from)))
      )
        continue;
      const next = resolve(position + 1, end + 1);
      if (!next.count) continue;
      result.ranges = [{ ...part, from, to }, ...next.ranges];
      result.count = Math.min(2, result.count + next.count);
      if (result.count === 2) break;
    }
    memo.set(key, result);
    return result;
  };

  const result = resolve(0, 0);
  return result.count === 1 ? result.ranges : undefined;
};
