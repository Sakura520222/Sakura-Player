import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import kuromoji from "kuromoji";
import type { AlignmentSourcePhrase, LocalAlignmentRequest } from "@shared/types/lyricAlignment";
import { alignRomanization } from "@shared/utils/lyricAlignment";
import { tokenizeAlignmentSource } from "./readings";

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
    const japanese =
      translation && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line.words.join(""));
    const tokens = japanese
      ? tokenizer!.tokenize(line.words.join("")).filter((token) => token.surface_form.trim())
      : [];
    const groups: number[][] = [];
    let pending: number[] = [];
    for (const [index, token] of (translation ? source : []).entries()) {
      if (japanese) {
        const current = tokens[index];
        const previous = tokens[index - 1];
        const dependent =
          ["助詞", "助動詞", "記号"].includes(current.pos) ||
          ["非自立", "接尾"].includes(current.pos_detail_1);
        const compound =
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
        pending = [];
      }
    }
    if (pending.length) {
      if (groups.length) groups.at(-1)!.push(...pending);
      else groups.push(pending);
    }
    return {
      id: line.id,
      source,
      sourcePhrases: groups.map((indices) => ({
        indices,
        text: indices.map((index) => source[index].text).join(japanese ? "" : " "),
      })) satisfies AlignmentSourcePhrase[],
      target: Array.from(segmenter.segment(line.translation), (segment) => segment.segment),
      romanization:
        request.romanization && line.romanization
          ? (alignRomanization(phonetic, line.romanization) ?? undefined)
          : undefined,
    };
  });
};

void prepare(workerData).then(
  (lines) => parentPort!.postMessage({ lines }),
  (error: unknown) =>
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
