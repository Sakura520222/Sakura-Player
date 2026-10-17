import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import kuromoji from "kuromoji";
import type { LocalAlignmentRequest } from "@shared/types/lyricAlignment";
import { alignRomanization } from "@shared/utils/lyricAlignment";
import { tokenizeAlignmentSource } from "./readings";

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
    const { source, phonetic } = tokenizeAlignmentSource(line, tokenizer);
    return {
      id: line.id,
      source,
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
