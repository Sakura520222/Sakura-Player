import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import kuromoji from "kuromoji";
import type { AlignmentSourcePhrase, LocalAlignmentRequest } from "@shared/types/lyricAlignment";
import { alignRomanization } from "@shared/utils/lyricAlignment";
import { tokenizeAlignmentSource } from "./readings";
import { alignPinyin } from "./pinyin";

const englishFunctionWords = new Set(
  "a an the to of in on at for by with from into over under about after before as than and or but if is am are was were be been being have has had would could should can may might must do does did not".split(
    " ",
  ),
);

/**
 * 按需加载词典，任务结束后由主进程释放整个 worker
 * @param request - 有界且已校验的当前歌词快照
 * @returns 原文词元、语言学短语、完整译文切片及读音匹配结果
 */
const prepare = async (request: LocalAlignmentRequest) => {
  let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures> | undefined;
  if (
    request.lines.some((line) =>
      /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(line.words.join("")),
    )
  ) {
    tokenizer = await new Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>>(
      (resolve, reject) => {
        kuromoji
          .builder({
            dicPath: path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict"),
          })
          .build((error, result) => (error ? reject(error) : resolve(result)));
      },
    );
  }
  const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  return request.lines.map((line) => {
    const { source, phonetic } = tokenizeAlignmentSource(line, tokenizer);
    const translation = request.translation && !!line.translation.trim();
    const text = line.words.join("");
    const japanese = translation && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
    let cursor = 0;
    const tokens = japanese
      ? tokenizer!
          .tokenize(text)
          .filter((token) => token.surface_form.trim())
          .map((token) => {
            const start = text.indexOf(token.surface_form, cursor);
            cursor = start + token.surface_form.length;
            return { ...token, start, end: cursor };
          })
      : [];
    cursor = 0;
    const features = japanese
      ? source.map((token) => {
          const start = text.indexOf(token.text, cursor);
          cursor = start + token.text.length;
          return tokens.find((word) => word.start <= start && word.end >= cursor)!;
        })
      : [];
    const groups: number[][] = [];
    const heads = new Set<number>();
    let pending: number[] = [];
    for (const [index, token] of (translation ? source : []).entries()) {
      if (japanese) {
        const current = features[index];
        const previous = features[index - 1];
        const dependent =
          ["助詞", "助動詞", "記号"].includes(current.pos) ||
          current.pos_detail_1 === "接尾" ||
          (current.pos_detail_1 === "非自立" && current.pos !== "名詞");
        if (!dependent) heads.add(index);
        const compound =
          current !== previous &&
          current.pos === "動詞" &&
          previous?.pos === "動詞" &&
          previous.conjugated_form.startsWith("連用");
        if (groups.length && (dependent || compound)) groups.at(-1)!.push(index);
        else if (dependent) pending.push(index);
        else {
          groups.push([...pending, index]);
          pending = [];
        }
      } else if (!/[\p{L}\p{N}]/u.test(token.text) && groups.length) {
        groups.at(-1)!.push(...pending, index);
        pending = [];
      } else if (englishFunctionWords.has(token.text.toLowerCase())) pending.push(index);
      else {
        groups.push([...pending, index]);
        if (/[\p{L}\p{N}]/u.test(token.text)) heads.add(index);
        pending = [];
      }
    }
    if (pending.length) {
      if (groups.length) groups.at(-1)!.push(...pending);
      else groups.push(pending);
    }
    const romanization =
      request.romanization && line.romanization
        ? (alignPinyin(line) ?? alignRomanization(phonetic, line.romanization))
        : null;
    return {
      id: line.id,
      source,
      sourcePhrases: groups.map((indices) => ({
        indices,
        text: indices.map((index) => source[index].text).join(japanese ? "" : " "),
        heads: indices.filter((index) => heads.has(index)),
        lemmas: indices.map((index) => {
          const feature = features[index];
          return feature &&
            feature.surface_form === source[index].text &&
            ["動詞", "形容詞"].includes(feature.pos) &&
            feature.basic_form !== "*"
            ? feature.basic_form
            : source[index].text;
        }),
      })) satisfies AlignmentSourcePhrase[],
      target: Array.from(segmenter.segment(line.translation), (segment) => segment.segment),
      romanization: romanization && romanization.parts.length > 1 ? romanization : undefined,
    };
  });
};

void prepare(workerData).then(
  (lines) => parentPort!.postMessage({ lines }),
  (error: unknown) =>
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
