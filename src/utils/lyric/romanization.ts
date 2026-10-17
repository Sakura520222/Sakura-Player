import { alignRomanization } from "lyric-kit";
import type { LyricWord, RomanizationSpan } from "@shared/types/lyrics";

export const ROMANIZATION_NAMESPACE = "urn:sakura-player:lyrics";
export const ROMANIZATION_LRC_KEY = "sakura-romanization";

/**
 * 读取 TTML 扩展中的包含下标，缺失或无效属性交给时间匹配
 * @param element - 单个音译时间片段
 * @returns 有效的原词范围或空对象
 */
export const readRomanizationRange = (element: Element): Pick<RomanizationSpan, "from" | "to"> => {
  const from = Number(
    element.getAttributeNS(ROMANIZATION_NAMESPACE, "from") ??
      element.getAttribute("sakura:from") ??
      NaN,
  );
  const to = Number(
    element.getAttributeNS(ROMANIZATION_NAMESPACE, "to") ??
      element.getAttribute("sakura:to") ??
      NaN,
  );
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to >= from
    ? { from, to }
    : {};
};

/**
 * 将跨词范围写入 TTML，保持标准时间与文本仍可被其他播放器读取
 * @param element - 待保存的音译片段
 * @param part - 时间、文本及可选原词范围
 */
export const writeRomanizationRange = (element: Element, part: RomanizationSpan): void => {
  if (part.from === undefined || part.to === undefined) return;
  element.ownerDocument.documentElement.setAttributeNS(
    "http://www.w3.org/2000/xmlns/",
    "xmlns:sakura",
    ROMANIZATION_NAMESPACE,
  );
  element.setAttributeNS(ROMANIZATION_NAMESPACE, "sakura:from", String(part.from));
  element.setAttributeNS(ROMANIZATION_NAMESPACE, "sakura:to", String(part.to));
};

/**
 * 恢复音译对应的原词范围，旧轨道仅在时间能唯一确定完整分组时升级
 * @param words - 保留原始下标的主歌词字词
 * @param parts - 带时间及可选原词范围的音译片段
 * @returns 已恢复范围的音译片段；不能可靠分组时沿用普通逐词匹配
 */
export const alignRomanizationWords = (
  words: LyricWord[],
  parts: RomanizationSpan[],
): RomanizationSpan[] => {
  const source = words.flatMap((word, index) => (word.word.trim() ? [{ word, index }] : []));
  const explicit = parts.some((part) => part.from !== undefined || part.to !== undefined);
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
      result.ranges = [{ ...part, ...(from !== to ? { from, to } : {}) }, ...next.ranges];
      result.count = Math.min(2, result.count + next.count);
      if (result.count === 2) break;
    }
    memo.set(key, result);
    return result;
  };

  for (const word of words) delete word.romanWord;
  // 旧逐行轨道没有原词范围，整句的首尾时间不能证明已有逐字关联
  const resolved =
    !explicit && parts.length === 1 && source.length > 1 ? { ranges: [], count: 0 } : resolve(0, 0);
  if (resolved.count === 1) {
    let cursor = 0;
    for (const part of resolved.ranges) {
      const from = part.from ?? source[cursor].index;
      const to = part.to ?? from;
      words[from].romanWord = part.word.trim();
      while (cursor < source.length && source[cursor].index <= to) cursor++;
    }
    return resolved.ranges;
  }
  alignRomanization(words, parts);
  return parts.map(({ from: _from, to: _to, ...part }) => part);
};
