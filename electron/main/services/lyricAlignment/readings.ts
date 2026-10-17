import type kuromoji from "kuromoji";
import { toHiragana, toRomaji } from "wanakana";
import type { AlignmentSourceLine } from "@shared/types/lyricAlignment";
import type { ReadingToken } from "@shared/utils/lyricAlignment";

interface KanaToken {
  text: string;
  readings: string[];
  from: number;
  to: number;
}

/**
 * 同时提供语义分词和按主歌词字词切分的读音，不按字符数平摊汉字读音
 * @param line - 原文字词、已有音译及可选假名
 * @param tokenizer - 当前任务独占的日语词典
 * @returns 语义词元和带词典候选读音的时间锚点
 */
export const tokenizeAlignmentSource = (
  line: AlignmentSourceLine,
  tokenizer?: kuromoji.Tokenizer<kuromoji.IpadicFeatures>,
): { source: ReadingToken[]; phonetic: ReadingToken[] } => {
  const text = line.words.join("");
  let offset = 0;
  const ranges = line.words.map((word, index) => {
    const start = offset;
    offset += word.length;
    return { start, end: offset, index };
  });
  const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text);
  const pieces =
    japanese && tokenizer
      ? tokenizer.tokenize(text).map((token) => ({
          text: token.surface_form,
          reading: token.reading || token.pronunciation || token.surface_form,
          pronunciation: token.pronunciation ?? "",
        }))
      : Array.from(
          new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
          (segment) => ({ text: segment.segment, reading: segment.segment, pronunciation: "" }),
        );
  const source: ReadingToken[] = [];
  const kana: KanaToken[] = [];
  const dictionary = new Map<string, string[]>();
  let cursor = 0;
  for (const piece of pieces) {
    const start = text.indexOf(piece.text, cursor);
    if (start < 0) throw new Error("日语分词与原文不一致");
    cursor = start + piece.text.length;
    const covered = ranges.filter((range) => range.start < cursor && range.end > start);
    if (!piece.text.trim() || !covered.length) continue;
    source.push({
      text: piece.text,
      reading: toRomaji(piece.reading),
      from: covered[0].index,
      to: covered.at(-1)!.index,
    });
    if (!japanese) {
      kana.push({ ...source.at(-1)!, readings: [piece.reading] });
      continue;
    }
    const runs = piece.text.match(/\p{Script=Han}+|[^\p{Script=Han}]+/gu)!;
    const pattern = runs
      .map((run) =>
        /\p{Script=Han}/u.test(run)
          ? "(.+?)"
          : `(${toHiragana(run).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      )
      .join("");
    const matched = new RegExp(`^${pattern}$`, "u").exec(toHiragana(piece.reading));
    let position = start;
    for (const [index, run] of (matched ? runs : [piece.text]).entries()) {
      const end = position + run.length;
      const words = ranges.filter((range) => range.start < end && range.end > position);
      const hasKanji = /\p{Script=Han}/u.test(run);
      const hinted =
        hasKanji &&
        words.every(
          (range) => line.readings?.[range.index] && range.start >= position && range.end <= end,
        );
      const chunks =
        !hasKanji || hinted
          ? words.map((range) => ({
              start: Math.max(position, range.start),
              end: Math.min(end, range.end),
              from: range.index,
              to: range.index,
            }))
          : [{ start: position, end, from: words[0].index, to: words.at(-1)!.index }];
      for (const chunk of chunks) {
        const surface = text.slice(chunk.start, chunk.end);
        const reading = hinted
          ? line.readings![chunk.from]
          : hasKanji
            ? (matched?.[index + 1] ?? piece.reading)
            : surface;
        if (!dictionary.has(surface)) {
          const candidates = new Set<string>();
          if (hasKanji && tokenizer) {
            // 使用同表记的全部词典读音，避免最优分词路径排除「辛」「欠片」等多音词
            const lattice = tokenizer.getLattice(surface) as kuromoji.ViterbiLattice & {
              nodes_end_at: kuromoji.ViterbiNode[][];
            };
            for (const nodes of lattice.nodes_end_at) {
              for (const node of nodes ?? []) {
                if (node.type !== "KNOWN" || node.surface_form !== surface) continue;
                const entry = tokenizer.formatter.formatEntry(
                  Number(node.name),
                  node.start_pos,
                  node.type,
                  tokenizer.token_info_dictionary.getFeatures(String(node.name)).split(","),
                );
                if (entry.reading) candidates.add(entry.reading);
                if (entry.pronunciation) candidates.add(entry.pronunciation);
              }
            }
          }
          dictionary.set(surface, [...candidates].slice(0, 16));
        }
        const previous = kana.at(-1);
        if (/^[ゃゅょぁぃぅぇぉャュョァィゥェォ]/u.test(surface) && previous) {
          previous.text += surface;
          previous.readings = previous.readings.map((value) => value + reading);
          previous.to = chunk.to;
        } else {
          kana.push({
            text: surface,
            readings: [
              ...new Set([
                reading,
                ...(chunk.start === start && chunk.end === cursor && piece.pronunciation
                  ? [piece.pronunciation]
                  : []),
                ...dictionary.get(surface)!,
              ]),
            ],
            from: chunk.from,
            to: chunk.to,
          });
        }
      }
      position = end;
    }
  }
  const phonetic = kana.map((token, index) => {
    const next = kana[index + 1]?.readings[0] ?? "";
    const readings = new Set<string>();
    for (const reading of token.readings) {
      let romaji = toRomaji(reading);
      if (/[っッ]$/u.test(reading)) {
        const suffix = toRomaji(next);
        const contextual = toRomaji(reading + next);
        romaji = suffix ? contextual.slice(0, -suffix.length) : romaji + "t";
        if (reading.length > 1) readings.add(toRomaji(reading));
      }
      if (romaji) readings.add(romaji);
      if (/^[っッ]$/u.test(reading)) readings.add("tsu");
    }
    // 助词转写同时接受 wo 和 o，只调整读音候选，保留现成音译文本
    if (/^[をヲ]$/u.test(token.text)) readings.add("o");
    // 连写的促音可以归在后词，如「一／歩」对应「i／ppo」
    if (/[っッ]$/u.test(kana[index - 1]?.readings[0] ?? "")) {
      for (const reading of [...readings]) {
        if (/^[bcdfghjklmpqrstvwxyz]/i.test(reading)) readings.add(reading[0] + reading);
      }
    }
    return {
      text: token.text,
      reading: [...readings][0] ?? "",
      readings: [...readings],
      from: token.from,
      to: token.to,
    };
  });
  return { source, phonetic };
};
