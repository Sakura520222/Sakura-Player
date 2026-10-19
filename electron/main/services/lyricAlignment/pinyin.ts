import { pinyin } from "pinyin-pro";
import type { AlignmentSourceLine, AlignmentTrackResult } from "@shared/types/lyricAlignment";

/**
 * 用词典拼音精确匹配完整中文音译，声调与空白仅用于保留原始切片
 * @param line - 含真实原词边界和现成拼音的歌词行
 * @returns 唯一且无缺字的拼音映射，无法验证或边界有歧义时返回 null
 */
export const alignPinyin = (line: AlignmentSourceLine): AlignmentTrackResult | null => {
  const text = line.words.join("");
  if (!/\p{Script=Han}/u.test(text) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))
    return null;
  let target = "";
  const offsets: number[] = [];
  for (let offset = 0; offset < line.romanization.length;) {
    const character = String.fromCodePoint(line.romanization.codePointAt(offset)!);
    if (/\p{L}/u.test(character) && !/\p{Script_Extensions=Latin}/u.test(character)) return null;
    const normalized = character
      .replace(/[üǖǘǚǜ]/gi, "v")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    target += normalized;
    for (let index = 0; index < normalized.length; index++) offsets.push(offset);
    offset += character.length;
  }
  if (!target || target.length > 1024) return null;
  let cursor = 0;
  const ranges = line.words.map((word, index) => {
    const start = cursor;
    cursor += word.length;
    return { start, end: cursor, index };
  });
  cursor = 0;
  let leading: number | undefined;
  const groups: { readings: string[]; from: number; to: number }[] = [];
  for (const token of pinyin(text, { type: "all", toneType: "none" })) {
    const end = cursor + token.origin.length;
    const covered = ranges.filter((range) => range.start < end && range.end > cursor);
    cursor = end;
    if (!covered.length) continue;
    const readings = [
      ...new Set(
        (token.isZh ? [token.result, ...token.polyphonic] : [token.origin])
          .map((reading) =>
            reading
              .replace(/[üǖǘǚǜ]/gi, "v")
              .normalize("NFKD")
              .toLowerCase()
              .replace(/[^a-z0-9]/g, ""),
          )
          .filter(Boolean),
      ),
    ];
    if (!readings.length) {
      if (/[\p{L}\p{N}]/u.test(token.origin)) return null;
      if (groups.length) groups.at(-1)!.to = covered.at(-1)!.index;
      else leading ??= covered[0].index;
      continue;
    }
    groups.push({ readings, from: leading ?? covered[0].index, to: covered.at(-1)!.index });
    leading = undefined;
  }
  const width = target.length + 1;
  let counts = new Uint8Array(width);
  counts[0] = 1;
  const traces: Int32Array[] = [];
  for (const group of groups) {
    const next = new Uint8Array(width);
    const starts = new Int32Array(width).fill(-1);
    for (let start = 0; start < width; start++) {
      if (!counts[start]) continue;
      for (const reading of group.readings) {
        const end = start + reading.length;
        if (end >= width || !target.startsWith(reading, start)) continue;
        next[end] = Math.min(2, next[end] + counts[start]);
        starts[end] = start;
      }
    }
    traces.push(starts);
    counts = next;
  }
  if (counts[target.length] !== 1) return null;
  const boundaries = new Int32Array(groups.length);
  cursor = target.length;
  for (let index = groups.length - 1; index >= 0; index--) {
    cursor = traces[index][cursor];
    boundaries[index] = index ? offsets[cursor] : 0;
  }
  const parts: AlignmentTrackResult["parts"] = [];
  for (const [index, group] of groups.entries()) {
    const content = line.romanization.slice(
      boundaries[index],
      boundaries[index + 1] ?? line.romanization.length,
    );
    const previous = parts.at(-1);
    if (previous && group.from <= previous.to) {
      previous.text += content;
      previous.to = Math.max(previous.to, group.to);
    } else parts.push({ text: content, from: group.from, to: group.to });
  }
  return parts.length ? { parts, score: 1 } : null;
};
