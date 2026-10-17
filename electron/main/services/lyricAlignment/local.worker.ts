import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import kuromoji from "kuromoji";
import { toRomaji } from "wanakana";
import type { AlignmentSourceLine, LocalAlignmentRequest } from "@shared/types/lyricAlignment";
import { alignRomanization, type ReadingToken } from "@shared/utils/lyricAlignment";

/**
 * 分词后仍以原始字词下标为准，日语整词可横跨多个带时间的字
 * @param line - 本行已有原文和辅助文本
 * @param tokenizer - 本次任务独占的日语词典
 * @returns 可供读音匹配和语义匹配共用的词元
 */
const tokenize = (
  line: AlignmentSourceLine,
  tokenizer?: kuromoji.Tokenizer<kuromoji.IpadicFeatures>,
): ReadingToken[] => {
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
          reading: toRomaji(token.pronunciation || token.reading || token.surface_form),
        }))
      : Array.from(
          new Intl.Segmenter(undefined, { granularity: "word" }).segment(text),
          (segment) => ({ text: segment.segment, reading: segment.segment }),
        );
  let cursor = 0;
  return pieces.flatMap((piece) => {
    const start = text.indexOf(piece.text, cursor);
    if (start < 0) throw new Error("日语分词与原文不一致");
    cursor = start + piece.text.length;
    const covered = ranges.filter((range) => range.start < cursor && range.end > start);
    if (!piece.text.trim() || !covered.length) return [];
    return [{ ...piece, from: covered[0].index, to: covered[covered.length - 1].index }];
  });
};

/**
 * 按需加载词典，任务结束后由主进程释放整个 worker
 * @param request - 有界且已校验的当前歌词快照
 * @returns 原文词元、完整译文切片及读音匹配结果
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
    const source = tokenize(line, tokenizer);
    return {
      id: line.id,
      source,
      target: Array.from(segmenter.segment(line.translation), (segment) => segment.segment),
      romanization:
        request.romanization && line.romanization
          ? (alignRomanization(source, line.romanization) ?? undefined)
          : undefined,
    };
  });
};

void prepare(workerData).then(
  (lines) => parentPort!.postMessage({ lines }),
  (error: unknown) =>
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }),
);
