import type { AlignmentPart, AlignmentTrackResult } from "../types/lyricAlignment";

export interface ReadingToken {
  text: string;
  reading: string;
  readings?: string[];
  from: number;
  to: number;
}

/**
 * 统一常见罗马字体系与长音，同时保留每个字符在原文本中的位置
 * @param text - 候选读音或已有音译
 * @returns 用于编辑距离的拉丁字符及原始切片边界
 */
const normalizeReading = (text: string): { text: string; offsets: number[] } => {
  let normalized = "";
  const offsets: number[] = [];
  for (let offset = 0; offset < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(offset)!);
    const value = (
      /^[āīūēōâîûêô]$/i.test(character)
        ? ({ a: "aa", i: "ii", u: "uu", e: "ee", o: "ou" } as Record<string, string>)[
            character.normalize("NFKD")[0].toLowerCase()
          ]
        : character
    )
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    normalized += value;
    for (let index = 0; index < value.length; index++) offsets.push(offset);
    offset += character.length;
  }
  const replacements = /shi|chi|tsu|ji|fu/gy;
  const rules: Record<string, string> = {
    shi: "si",
    chi: "ti",
    tsu: "tu",
    ji: "zi",
    fu: "hu",
  };
  let result = "";
  const positions: number[] = [];
  for (let index = 0; index < normalized.length;) {
    replacements.lastIndex = index;
    const match = replacements.exec(normalized);
    const value = match ? rules[match[0]] : normalized[index];
    result += value;
    for (let part = 0; part < value.length; part++)
      positions.push(
        offsets[index + (match && part === value.length - 1 ? match[0].length - 1 : part)],
      );
    index += match?.[0].length ?? 1;
  }
  return { text: result, offsets: positions };
};

/**
 * 在候选读音图上求全局编辑距离，保留主歌词字词边界及已有音译的原始切片
 * @param tokens - 按原文顺序排列、带候选读音的语言学词元
 * @param existing - 必须原样保留的现成音译
 * @returns 可靠时的完整切片；缺词、错读或超长输入返回 null
 */
export const alignRomanization = (
  tokens: ReadingToken[],
  existing: string,
): AlignmentTrackResult | null => {
  if (
    [...existing].some(
      (character) => /\p{L}/u.test(character) && !/\p{Script_Extensions=Latin}/u.test(character),
    )
  )
    return null;
  const groups: { text: string; readings: string[]; from: number; to: number }[] = [];
  for (const token of tokens) {
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token.reading)
    )
      return null;
    const readings = [
      ...new Set(
        (token.readings ?? [token.reading])
          .flatMap((reading) => {
            const normalized = normalizeReading(reading).text;
            return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token.text)
              ? [
                  normalized,
                  normalized.replace(/oo/g, "ou"),
                  normalized.replace(/ou/g, "oo"),
                  normalized.replace(/oo|ou/g, "o"),
                ]
              : [normalized];
          })
          .filter(Boolean),
      ),
    ];
    if (!readings.length) {
      if (/[\p{L}\p{N}]/u.test(token.text)) return null;
      continue;
    }
    groups.push({ text: token.text, readings, from: token.from, to: token.to });
  }
  const target = normalizeReading(existing);
  if (
    !groups.length ||
    !target.text ||
    target.text.length > 1024 ||
    groups.some((group) => group.readings.length > 32) ||
    groups.reduce(
      (size, group) => size + group.readings.reduce((n, reading) => n + reading.length, 0),
      0,
    ) > 4096
  )
    return null;
  const width = target.text.length + 1;
  const boundaryCosts = Float64Array.from({ length: width }, (_, column) =>
    column > 0 &&
    column < target.text.length &&
    /\s/.test(existing) &&
    !/\s/.test(existing.slice(target.offsets[column - 1] + 1, target.offsets[column]))
      ? 1 / 4096
      : 0,
  );
  const traces: { choices: Uint8Array; variants: Uint8Array[] }[] = [];
  let costs = Float64Array.from({ length: width }, (_, index) => index);
  for (const [index, group] of groups.entries()) {
    const best = new Float64Array(width).fill(Infinity);
    const choices = new Uint8Array(width);
    const variants: Uint8Array[] = [];
    for (const [variant, reading] of group.readings.entries()) {
      const steps = new Uint8Array((reading.length + 1) * width);
      // 同分时优先保留音节边界和主歌词注音，避免另一读音路径挤掉可靠锚点
      let previous = costs.map(
        (cost, column) => cost + (index > 0 ? boundaryCosts[column] : 0) + variant / 1048576,
      );
      for (let row = 1; row <= reading.length; row++) {
        const current = new Float64Array(width);
        current[0] = previous[0] + 1;
        for (let column = 1; column < width; column++) {
          const match =
            previous[column - 1] + (reading[row - 1] === target.text[column - 1] ? 0 : 1);
          const deletion = previous[column] + 1;
          const insertion = current[column - 1] + 1;
          current[column] = Math.min(match, deletion, insertion);
          steps[row * width + column] =
            current[column] === match ? 0 : current[column] === deletion ? 1 : 2;
        }
        previous = current;
      }
      for (let column = 0; column < width; column++) {
        if (previous[column] < best[column]) {
          best[column] = previous[column];
          choices[column] = variant;
        }
      }
      variants.push(steps);
    }
    costs = best;
    traces.push({ choices, variants });
  }
  const starts = new Int32Array(groups.length);
  const coverage: number[] = [];
  let column = target.text.length;
  let edits = 0;
  let length = 0;
  for (let index = groups.length - 1; index >= 0; index--) {
    const trace = traces[index];
    const variant = trace.choices[column];
    const reading = groups[index].readings[variant];
    const steps = trace.variants[variant];
    let row = reading.length;
    let first = -1;
    let exact = 0;
    length += row;
    while (row > 0) {
      const step = column > 0 ? steps[row * width + column] : 1;
      if (step === 0) {
        first = --column;
        if (reading[--row] === target.text[column]) exact++;
        else edits++;
      } else if (step === 1) {
        row--;
        edits++;
      } else {
        column--;
        edits++;
      }
    }
    if (first < 0) return null;
    coverage[index] = exact / reading.length;
    starts[index] = first;
  }
  const score = 1 - (edits + column) / Math.max(length, target.text.length);
  if (score < 0.8) return null;
  const uncertain = coverage.flatMap((ratio, index) => (ratio < 0.7 ? [index] : []));
  for (const index of uncertain) {
    // 现成音译可能采用词典没有的汉字读音，只允许强读音锚点夹住的单个原词沿用其时间
    if (
      uncertain.length > 1 ||
      groups[index].from !== groups[index].to ||
      !/\p{Script=Han}/u.test(groups[index].text) ||
      index < 2 ||
      index + 2 >= groups.length ||
      coverage.slice(index - 2, index).some((ratio) => ratio !== 1) ||
      coverage.slice(index + 1, index + 3).some((ratio) => ratio !== 1)
    )
      return null;
  }
  const boundaries = Array.from(starts, (position, index) => {
    if (index === 0) return 0;
    const offset = target.offsets[position];
    return /['’]/.test(existing[offset - 1] ?? "") ? offset - 1 : offset;
  });
  const parts: AlignmentPart[] = [];
  for (const [index, group] of groups.entries()) {
    const start = boundaries[index];
    const end = index + 1 === groups.length ? existing.length : boundaries[index + 1];
    const previous = parts.at(-1);
    if (
      previous &&
      (group.from <= previous.to ||
        start === end ||
        (starts[index] > 0 && target.offsets[starts[index]] === target.offsets[starts[index] - 1]))
    ) {
      previous.text += existing.slice(start, end);
      previous.to = Math.max(previous.to, group.to);
    } else parts.push({ text: existing.slice(start, end), from: group.from, to: group.to });
  }
  return parts.every((part) => part.text.trim()) ? { parts, score } : null;
};

/**
 * 将跨语言词配对归并为顺序语义短语，冲突只合并、不凭字数伪造时间
 * @param source - 带原文字词范围的分词
 * @param target - 保留空白和标点的译文切片
 * @param pairs - SimAlign 返回的词索引配对
 * @returns 完整且具有至少两个时间锚点的译文映射，否则返回 null
 */
export const alignTranslation = (
  source: Pick<ReadingToken, "text" | "from" | "to">[],
  target: string[],
  pairs: number[][],
): AlignmentTrackResult | null => {
  if (!source.length || !target.length) return null;
  const anchors = target.map(() => new Set<number>());
  const covered = new Set<number>();
  for (const pair of pairs) {
    if (pair.length !== 2) return null;
    const [from, to] = pair;
    if (!Number.isInteger(from) || !Number.isInteger(to) || !source[from] || !anchors[to])
      return null;
    anchors[to].add(from);
    covered.add(from);
  }
  const meaningful = target.map((text) => /[\p{L}\p{N}]/u.test(text));
  // 未匹配的实词保留逐行显示，不能把增译部分任意塞进相邻时间片
  if (anchors.some((indices, index) => meaningful[index] && indices.size === 0)) return null;
  const sourceWords = source.filter((token) => /[\p{L}\p{N}]/u.test(token.text));
  const score = sourceWords.length
    ? source.filter((token, index) => covered.has(index) && /[\p{L}\p{N}]/u.test(token.text))
        .length / sourceWords.length
    : 0;
  if (score < 0.65) return null;
  const parts: AlignmentPart[] = [];
  let leading = "";
  for (const [index, text] of target.entries()) {
    const indices = [...anchors[index]];
    if (!indices.length) {
      if (parts.length) parts[parts.length - 1].text += text;
      else leading += text;
      continue;
    }
    const part = {
      text: leading + text,
      from: Math.min(...indices.map((id) => source[id].from)),
      to: Math.max(...indices.map((id) => source[id].to)),
    };
    leading = "";
    while (parts.length && parts[parts.length - 1].to >= part.from) {
      const previous = parts.pop()!;
      part.text = previous.text + part.text;
      part.from = Math.min(previous.from, part.from);
      part.to = Math.max(previous.to, part.to);
    }
    parts.push(part);
  }
  return parts.length > 1 ? { parts, score } : null;
};
