import type { AlignmentPart, AlignmentTrackResult } from "../types/lyricAlignment";

interface ReadingGroup {
  text: string;
  readings: string[];
  from: number;
  to: number;
  anchorFrom?: number;
  anchorTo?: number;
}

/**
 * 用其余读音的完整精确匹配定位单个汉字词，只有边界唯一且锚点充分时接受
 * @param groups - 已规范化的候选读音与原词范围
 * @param target - 现成音译的规范化字符与原文位置
 * @param existing - 必须原样保留的音译
 * @returns 唯一锚定的完整映射，缺词、多处差异或边界歧义返回 null
 */
export const alignRomanizationByAnchors = (
  groups: ReadingGroup[],
  target: { text: string; offsets: number[] },
  existing: string,
): AlignmentTrackResult | null => {
  const unresolved = groups.flatMap((group, index) => (!group.readings.length ? [index] : []));
  const candidates = groups.flatMap((group, index) =>
    (group.anchorFrom ?? group.from) === (group.anchorTo ?? group.to) &&
    /^\p{Script=Han}+$/u.test(group.text) &&
    (!unresolved.length || unresolved[0] === index)
      ? [index]
      : [],
  );
  if (!candidates.length || unresolved.length > 1) return null;
  const length = target.text.length;
  const width = length + 1;
  const prefix = [new Uint8Array(width)];
  const prefixCosts = [new Float64Array(width).fill(Infinity)];
  prefix[0][0] = 1;
  prefixCosts[0][0] = 0;
  for (const [index, group] of groups.entries()) {
    const next = new Uint8Array(width);
    const costs = new Float64Array(width).fill(Infinity);
    for (let start = 0; start < width; start++) {
      if (!prefix[index][start]) continue;
      for (const reading of group.readings) {
        const end = start + reading.length;
        if (end > length || !target.text.startsWith(reading, start)) continue;
        const cost = prefixCosts[index][start] + Number(!reading.length);
        if (cost < costs[end]) {
          costs[end] = cost;
          next[end] = prefix[index][start];
        } else if (cost === costs[end]) next[end] = Math.min(2, next[end] + prefix[index][start]);
      }
    }
    prefix.push(next);
    prefixCosts.push(costs);
  }
  const suffix: Uint8Array[] = new Array(groups.length + 1);
  const suffixCosts: Float64Array[] = new Array(groups.length + 1);
  suffix[groups.length] = new Uint8Array(width);
  suffixCosts[groups.length] = new Float64Array(width).fill(Infinity);
  suffix[groups.length][length] = 1;
  suffixCosts[groups.length][length] = 0;
  for (let index = groups.length - 1; index >= 0; index--) {
    const counts = new Uint8Array(width);
    const costs = new Float64Array(width).fill(Infinity);
    for (let start = 0; start < width; start++) {
      for (const reading of groups[index].readings) {
        const end = start + reading.length;
        if (end > length || !suffix[index + 1][end] || !target.text.startsWith(reading, start))
          continue;
        const cost = suffixCosts[index + 1][end] + Number(!reading.length);
        if (cost < costs[start]) {
          costs[start] = cost;
          counts[start] = suffix[index + 1][end];
        } else if (cost === costs[start])
          counts[start] = Math.min(2, counts[start] + suffix[index + 1][end]);
      }
    }
    suffix[index] = counts;
    suffixCosts[index] = costs;
  }
  let plan: { index: number; start: number; end: number; score: number } | undefined;
  for (const index of candidates) {
    const knownAnchors = groups.filter(
      (group, position) =>
        position !== index && group.readings.length && !/^[っッ]$/u.test(group.text),
    ).length;
    const anchoredUnknown = !groups[index].readings.length && knownAnchors >= 4;
    const limit = length * (anchoredUnknown ? 0.5 : 0.2);
    for (let start = 0; start < length; start++) {
      if (
        !prefix[index][start] ||
        (start > 0 && target.offsets[start] === target.offsets[start - 1])
      )
        continue;
      for (let end = start + 1; end <= length && end - start <= limit; end++) {
        if (
          !suffix[index + 1][end] ||
          (end < length && target.offsets[end] === target.offsets[end - 1])
        )
          continue;
        // 多条精确路径也可能藏着不同的原词切分，不能任选一条生成时间
        if (plan || prefix[index][start] > 1 || suffix[index + 1][end] > 1) return null;
        // 未收录汉字可由四个完整读音锚定，已知文字仍须占至少一半
        const score = Math.max(
          1 - (end - start) / length,
          anchoredUnknown ? knownAnchors / (knownAnchors + 1) : 0,
        );
        plan = { index, start, end, score };
      }
    }
  }
  if (!plan) return null;
  const starts = new Int32Array(groups.length);
  starts[plan.index] = plan.start;
  let cursor = plan.start;
  for (let index = plan.index - 1; index >= 0; index--) {
    const reading = groups[index].readings.find((reading) => {
      const start = cursor - reading.length;
      return (
        start >= 0 &&
        prefix[index][start] &&
        prefixCosts[index][start] + Number(!reading.length) === prefixCosts[index + 1][cursor] &&
        target.text.startsWith(reading, start)
      );
    })!;
    cursor -= reading.length;
    starts[index] = cursor;
  }
  cursor = plan.end;
  for (let index = plan.index + 1; index < groups.length; index++) {
    starts[index] = cursor;
    const reading = groups[index].readings.find(
      (reading) =>
        suffix[index + 1][cursor + reading.length] &&
        suffixCosts[index + 1][cursor + reading.length] + Number(!reading.length) ===
          suffixCosts[index][cursor] &&
        target.text.startsWith(reading, cursor),
    )!;
    cursor += reading.length;
  }
  const boundaries = Array.from(starts, (position, index) => {
    if (!index) return 0;
    const offset = target.offsets[position] ?? existing.length;
    return /['’]/.test(existing[offset - 1] ?? "") ? offset - 1 : offset;
  });
  const parts: AlignmentPart[] = [];
  for (const [index, group] of groups.entries()) {
    const text = existing.slice(boundaries[index], boundaries[index + 1] ?? existing.length);
    const previous = parts.at(-1);
    if (
      previous &&
      (group.from <= previous.to ||
        !/[\p{L}\p{N}]/u.test(text) ||
        !/[\p{L}\p{N}]/u.test(previous.text))
    ) {
      previous.text += text;
      previous.to = Math.max(previous.to, group.to);
    } else parts.push({ text, from: group.from, to: group.to });
  }
  return parts.every((part) => part.text.trim()) ? { parts, score: plan.score } : null;
};
