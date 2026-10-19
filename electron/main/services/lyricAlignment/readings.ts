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
  /**
   * 收集同表记的全部词典读音，缓存仅保留当前行的查询
   * @param spelling - 必须完整命中的表记
   * @returns 有界的词典读音，未收录时为空
   */
  const dictionaryReadings = (spelling: string): string[] => {
    const cached = dictionary.get(spelling);
    if (cached) return cached;
    const candidates = new Set<string>();
    if (tokenizer) {
      const lattice = tokenizer.getLattice(spelling) as kuromoji.ViterbiLattice & {
        nodes_end_at: kuromoji.ViterbiNode[][];
      };
      for (const nodes of lattice.nodes_end_at) {
        for (const node of nodes ?? []) {
          if (node.type !== "KNOWN" || node.surface_form !== spelling) continue;
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
    const readings = [...candidates].slice(0, 16);
    dictionary.set(spelling, readings);
    return readings;
  };
  let cursor = 0;
  for (const piece of pieces) {
    const start = text.indexOf(piece.text, cursor);
    if (start < 0) throw new Error("日语分词与原文不一致");
    cursor = start + piece.text.length;
    const covered = ranges.filter((range) => range.start < cursor && range.end > start);
    if (!piece.text.trim() || !covered.length) continue;
    const half = piece.text.length / 2;
    const readingHalf = piece.reading.length / 2;
    const repeated =
      japanese &&
      /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(piece.text) &&
      half >= 2 &&
      Number.isInteger(half) &&
      Number.isInteger(readingHalf) &&
      piece.text.slice(0, half) === piece.text.slice(half) &&
      piece.reading.slice(0, readingHalf) === piece.reading.slice(readingHalf);
    for (let part = 0; part < (repeated ? 2 : 1); part++) {
      const from = start + (repeated ? part * half : 0);
      const to = repeated ? from + half : cursor;
      const timed = covered.filter((range) => range.start < to && range.end > from);
      source.push({
        text: repeated ? piece.text.slice(part * half, (part + 1) * half) : piece.text,
        reading: toRomaji(
          repeated
            ? piece.reading.slice(part * readingHalf, (part + 1) * readingHalf)
            : piece.reading,
        ),
        from: timed[0].index,
        to: timed.at(-1)!.index,
      });
    }
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
      const hasKanji = /[\p{Script=Han}\p{N}]/u.test(run);
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
        const previous = kana.at(-1);
        if (/^[ゃゅょぁぃぅぇぉャュョァィゥェォー]/u.test(surface) && previous) {
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
                ...(hasKanji ? dictionaryReadings(surface) : []),
                ...(hasKanji && matched && chunk.start === position && chunk.end === end
                  ? dictionaryReadings(piece.text).flatMap((value) => {
                      const candidate = new RegExp(`^${pattern}$`, "u").exec(toHiragana(value));
                      return candidate?.[index + 1] ? [candidate[index + 1]] : [];
                    })
                  : []),
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
  for (const token of kana) {
    if (!/^[0-9０-９]{1,4}$/u.test(token.text) || line.readings?.[token.from]) continue;
    let value = Number(token.text.normalize("NFKC"));
    let spelling = "";
    for (const [unit, suffix] of [
      [1000, "千"],
      [100, "百"],
      [10, "十"],
      [1, ""],
    ] as const) {
      const digit = Math.floor(value / unit);
      value %= unit;
      if (digit)
        spelling += (digit === 1 && unit > 1 ? "" : "〇一二三四五六七八九"[digit]) + suffix;
    }
    if (!spelling) spelling = "〇";
    token.readings.push(...dictionaryReadings(spelling));
  }
  for (let index = 0; index + 1 < kana.length; index++) {
    const token = kana[index];
    const next = kana[index + 1];
    if (
      !/^[0-9０-９〇一二三四五六七八九]$/u.test(token.text) ||
      !/^[\p{Script=Han}つ]+$/u.test(next.text) ||
      line.readings?.[token.from] ||
      !tokenizer
    )
      continue;
    // 数字的人数等惯用读法必须由完整词典条目证明，不能按字数拆分其读音
    const converted =
      (/^[0-9０-９]$/u.test(token.text)
        ? "〇一二三四五六七八九"[Number(token.text.normalize("NFKC"))]
        : token.text) + next.text;
    const readings = dictionaryReadings(converted);
    if (!readings.length) continue;
    kana.splice(index, 2, {
      text: token.text + next.text,
      readings: [
        ...new Set([
          ...readings,
          ...token.readings.flatMap((first) => next.readings.map((second) => first + second)),
        ]),
      ].slice(0, 16),
      from: token.from,
      to: next.to,
    });
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
      // 小元音外来语同时接受惯用拼写和逐假名展开，沿用同一原词范围
      if (/[ァィゥェォ]/u.test(reading)) {
        const foreign: Record<string, string> = {
          ファ: "fa",
          フィ: "fi",
          フェ: "fe",
          フォ: "fo",
          ティ: "ti",
          ディ: "di",
          トゥ: "tu",
          ドゥ: "du",
          ウィ: "wi",
          ウェ: "we",
          ウォ: "wo",
        };
        readings.add(
          toRomaji(
            reading.replace(
              /フ[ァィェォ]|[テデ]ィ|[トド]ゥ|ウ[ィェォ]/gu,
              (value) => foreign[value],
            ),
          ),
        );
        readings.add(Array.from(reading, (character) => toRomaji(character)).join(""));
      }
      if (/^[ぢヂ]$/u.test(reading)) readings.add("di");
      if (/^[づヅ]$/u.test(reading)) readings.add("du");
      if (/ー/u.test(reading)) readings.add(romaji.replace(/([aeiou])\1/g, "$1"));
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
