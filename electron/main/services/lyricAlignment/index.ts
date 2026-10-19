import { Worker } from "node:worker_threads";
import path from "node:path";
import { z } from "zod";
import type {
  AlignmentLineResult,
  AlignmentSourcePhrase,
  LocalAlignmentRequest,
} from "@shared/types/lyricAlignment";
import { alignTranslation, type ReadingToken } from "@shared/utils/lyricAlignment";
import { acquireAlignmentEnvironment, alignmentScript } from "./environment";
import { runAlignmentPython } from "./process";

export const alignmentRequestSchema = z
  .object({
    requestId: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[\w-]+$/),
    lines: z
      .array(
        z
          .object({
            id: z.number().int().nonnegative(),
            words: z.array(z.string().max(1024)).min(1).max(256),
            readings: z.array(z.string().max(1024)).max(256).optional(),
            translation: z.string().max(2048),
            romanization: z.string().max(2048),
          })
          .refine((line) => !line.readings || line.readings.length === line.words.length),
      )
      .min(1)
      .max(1000),
    translation: z.boolean(),
    romanization: z.boolean(),
  })
  .refine(
    (request) =>
      (request.translation || request.romanization) &&
      new Set(request.lines.map((line) => line.id)).size === request.lines.length &&
      request.lines.reduce(
        (size, line) =>
          size +
          line.words.join("").length +
          (line.readings?.join("").length ?? 0) +
          line.translation.length +
          line.romanization.length,
        0,
      ) <= 64_000,
  );

interface PreparedLine extends AlignmentLineResult {
  source: ReadingToken[];
  sourcePhrases?: AlignmentSourcePhrase[];
  target: string[];
}

/**
 * 为一次请求创建词典 worker，成功、失败或取消后均释放词典
 * @param request - 已校验的歌词文本
 * @param signal - 窗口和用户共享的取消信号
 * @returns 词元与音译映射
 */
const prepareLines = async (
  request: LocalAlignmentRequest,
  signal: AbortSignal,
): Promise<PreparedLine[]> => {
  signal.throwIfAborted();
  const worker = new Worker(path.join(__dirname, "lyric-alignment.worker.js"), {
    workerData: request,
  });
  try {
    return await new Promise((resolve, reject) => {
      const abort = () => reject(new Error("对齐已取消"));
      signal.addEventListener("abort", abort, { once: true });
      worker.once("message", (message: { lines?: PreparedLine[]; error?: string }) => {
        signal.removeEventListener("abort", abort);
        if (message.error || !message.lines) reject(new Error(message.error || "对齐结果无效"));
        else resolve(message.lines);
      });
      worker.once("error", reject);
      worker.once("exit", () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("对齐进程已退出"));
      });
    });
  } finally {
    await worker.terminate();
  }
};

/**
 * 通过标准输入向离线模型传递文本，输出和诊断均有大小上限
 * @param lines - 需要语义匹配的词元
 * @param signal - 取消后立即终止模型进程
 * @param environment - 已持有使用权的专用运行环境
 * @returns 按稳定行号返回的词索引配对及语言学短语候选
 */
const runSimAlign = async (
  lines: PreparedLine[],
  signal: AbortSignal,
  environment: Awaited<ReturnType<typeof acquireAlignmentEnvironment>>,
) => {
  signal.throwIfAborted();
  const payload = lines.map((line) => ({
    id: line.id,
    source: line.source.map((token) => token.text),
    phrases: line.sourcePhrases,
    target: line.target,
  }));
  const output = await runAlignmentPython(
    environment.python,
    ["-I", "-u", alignmentScript, "--model-dir", environment.modelDirectory],
    environment.env,
    signal,
    JSON.stringify(payload),
  );
  const pairs = z
    .array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]))
    .max(65536);
  const results = z
    .array(
      z.object({
        id: z.number().int(),
        pairs,
        alternatives: z.array(pairs).max(8).default([]),
      }),
    )
    .max(1000)
    .parse(JSON.parse(output));
  if (
    results.length !== lines.length ||
    new Set(results.map((line) => line.id)).size !== lines.length ||
    results.some((line) => !lines.some((input) => input.id === line.id))
  )
    throw new Error("SimAlign 返回的歌词行不完整");
  return new Map(results.map((line) => [line.id, line]));
};

/**
 * 分别运行读音与语义对齐，语义环境缺失不会丢弃已完成的音译
 * @param request - 已校验的本地请求
 * @param signal - 本次任务的取消信号
 * @returns 可预览的可靠映射及可操作的环境诊断
 */
export const runLocalAlignment = async (request: LocalAlignmentRequest, signal: AbortSignal) => {
  signal.throwIfAborted();
  let environment: Awaited<ReturnType<typeof acquireAlignmentEnvironment>> | undefined;
  let translationError: string | undefined;
  if (request.translation && request.lines.some((line) => line.translation.trim())) {
    try {
      environment = await acquireAlignmentEnvironment();
    } catch (error) {
      signal.throwIfAborted();
      translationError = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    const prepared = await prepareLines(request, signal);
    const translated = prepared.filter(
      (line) =>
        request.translation && line.target.some((text) => text.trim()) && line.source.length,
    );
    if (environment && translated.length) {
      try {
        const pairs = await runSimAlign(translated, signal, environment);
        for (const line of translated) {
          const result = pairs.get(line.id)!;
          for (const candidate of [result.pairs, ...result.alternatives]) {
            const translation = alignTranslation(line.source, line.target, candidate);
            if (!translation) continue;
            line.translation = translation;
            break;
          }
        }
      } catch (error) {
        signal.throwIfAborted();
        translationError = error instanceof Error ? error.message : String(error);
      }
    }
    signal.throwIfAborted();
    return {
      lines: prepared.map(({ id, translation, romanization }) => ({
        id,
        translation,
        romanization,
      })),
      translationError,
    };
  } finally {
    environment?.release();
  }
};
