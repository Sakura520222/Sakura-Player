import type { AlignmentPart, AlignmentTrackResult } from "../types/lyricAlignment";

export interface ReadingToken {
  text: string;
  reading: string;
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
    const value = character
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    normalized += value;
    for (let index = 0; index < value.length; index++) offsets.push(offset);
    offset += character.length;
  }
  const replacements = /shi|chi|tsu|ji|fu|ou|oo/gy;
  const rules: Record<string, string> = {
    shi: "si",
    chi: "ti",
    tsu: "tu",
    ji: "zi",
    fu: "hu",
    ou: "o",
    oo: "o",
  };
  let result = "";
  const positions: number[] = [];
  for (let index = 0; index < normalized.length;) {
    replacements.lastIndex = index;
    const candidate = replacements.exec(normalized);
    const match =
      candidate &&
      offsets[index + candidate[0].length - 1] - offsets[index] === candidate[0].length - 1
        ? candidate
        : null;
    const value = match ? rules[match[0]] : normalized[index];
    result += value;
    for (let part = 0; part < value.length; part++) positions.push(offsets[index + part]);
    index += match?.[0].length ?? 1;
  }
  return { text: result, offsets: positions };
};

/**
 * 全局编辑距离对齐读音；词内拆分与跨原词合并均沿用原文字词范围
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
  const groups: { reading: string; from: number; to: number }[] = [];
  for (const token of tokens) {
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token.reading)
    )
      return null;
    const reading = normalizeReading(token.reading).text;
    if (!reading) {
      if (/[\p{L}\p{N}]/u.test(token.text)) return null;
      continue;
    }
    const previous = groups.at(-1);
    if (previous && token.from <= previous.to) {
      previous.to = Math.max(previous.to, token.to);
      previous.reading += reading;
    } else groups.push({ reading, from: token.from, to: token.to });
  }
  const source = groups.map((group) => group.reading).join("");
  const target = normalizeReading(existing);
  if (!source || !target.text || source.length > 1024 || target.text.length > 1024) return null;
  const width = target.text.length + 1;
  const steps = new Uint8Array((source.length + 1) * width);
  let previous = Float32Array.from({ length: width }, (_, index) => index);
  for (let row = 1; row <= source.length; row++) {
    const current = new Float32Array(width);
    current[0] = row;
    for (let column = 1; column < width; column++) {
      const match = previous[column - 1] + (source[row - 1] === target.text[column - 1] ? 0 : 1);
      const deletion = previous[column] + 1;
      const insertion = current[column - 1] + 1;
      current[column] = Math.min(match, deletion, insertion);
      steps[row * width + column] =
        current[column] === match ? 0 : current[column] === deletion ? 1 : 2;
    }
    previous = current;
  }
  const score = 1 - previous[width - 1] / Math.max(source.length, target.text.length);
  if (score < 0.8) return null;
  const mapping = new Int32Array(source.length).fill(-1);
  let row = source.length,
    column = target.text.length;
  while (row > 0 && column > 0) {
    const step = steps[row * width + column];
    if (step === 0) mapping[--row] = --column;
    else if (step === 1) row--;
    else column--;
  }
  const boundaries = [0];
  let offset = 0;
  for (const [index, group] of groups.entries()) {
    const matches = Array.from(mapping.slice(offset, offset + group.reading.length));
    const exact = matches.filter(
      (position, part) => position >= 0 && source[offset + part] === target.text[position],
    ).length;
    if (exact / group.reading.length < 0.7) return null;
    if (index > 0) {
      const start = matches.find((position) => position >= 0);
      if (start === undefined) return null;
      boundaries.push(target.offsets[start]);
    }
    offset += group.reading.length;
  }
  boundaries.push(existing.length);
  const parts = groups.map((group, index) => ({
    text: existing.slice(boundaries[index], boundaries[index + 1]),
    from: group.from,
    to: group.to,
  }));
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
