import { z } from "zod";
import type { AlignmentLineResult, LocalAlignmentRequest } from "@shared/types/lyricAlignment";
import { acquireAlignmentEnvironment } from "./environment";
import { getAlignmentExecutable } from "./native";
import { runAlignmentNative } from "./process";
import { runPrimaryAlignment } from "./acoustic";

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
            primary: z
              .object({ startTime: z.number().nonnegative(), endTime: z.number().max(86_400_000) })
              .refine((range) => range.endTime > range.startTime)
              .optional(),
          })
          .refine((line) => !line.readings || line.readings.length === line.words.length),
      )
      .min(1)
      .max(1000),
    translation: z.boolean(),
    romanization: z.boolean(),
    primary: z
      .object({ trackId: z.string().min(1).max(2048), language: z.enum(["zh", "ja", "en"]) })
      .optional(),
  })
  .refine(
    (request) =>
      (request.translation || request.romanization || !!request.primary) &&
      request.lines.every((line) => !line.primary || !!request.primary) &&
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

const trackResultSchema = z.object({
  parts: z
    .array(
      z.object({
        text: z.string().max(2048),
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(2048),
  score: z.number().min(0).max(1),
});
const responseSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        translation: trackResultSchema.optional(),
        romanization: trackResultSchema.optional(),
      }),
    )
    .max(1000),
  translationError: z.string().max(4096).optional(),
});

/**
 * 先生成所选主歌词时间，再串行对齐辅助轨道，避免声学和语义模型同时驻留
 * @param request - 已校验的当前歌词快照
 * @param signal - 用户、窗口退出或应用退出共享的取消信号
 * @returns 保留原文和字词范围的辅助轨道候选
 */
export const runLocalAlignment = async (
  request: LocalAlignmentRequest,
  signal: AbortSignal,
): Promise<{ lines: AlignmentLineResult[]; translationError?: string }> => {
  signal.throwIfAborted();
  const primary = request.primary ? await runPrimaryAlignment(request, signal) : [];
  if (request.primary) {
    const timed = new Map(primary.map((line) => [line.id, line.primary]));
    request = {
      ...request,
      lines: request.lines
        .map((line) => {
          const result = timed.get(line.id);
          return result
            ? { ...line, words: result.words.map((word) => word.word), readings: undefined }
            : line.primary
              ? { ...line, translation: "", romanization: "" }
              : line;
        })
        .filter(
          (line) =>
            line.words.length <= 256 &&
            ((request.translation && line.translation.trim()) ||
              (request.romanization && line.romanization.trim())),
        ),
    };
    if (!request.lines.length || (!request.translation && !request.romanization))
      return { lines: primary };
  }
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
    let output: string;
    try {
      output = await runAlignmentNative(
        getAlignmentExecutable(),
        environment ? ["--model-dir", environment.modelDirectory] : [],
        signal,
        JSON.stringify(request),
      );
    } catch (error) {
      signal.throwIfAborted();
      if (
        primary.length &&
        (!request.romanization || !request.lines.some((line) => line.romanization.trim()))
      )
        return {
          lines: primary,
          translationError: error instanceof Error ? error.message : String(error),
        };
      if (
        !environment ||
        !request.romanization ||
        !request.lines.some((line) => line.romanization.trim())
      )
        throw error;
      // 模型分配失败等异常可能直接终止进程，单独重做读音才能保留原有的逐轨回退能力
      translationError = error instanceof Error ? error.message : String(error);
      output = await runAlignmentNative(
        getAlignmentExecutable(),
        [],
        signal,
        JSON.stringify({ ...request, translation: false }),
      );
    }
    signal.throwIfAborted();
    const result = responseSchema.parse(JSON.parse(output));
    const originals = new Map(request.lines.map((line) => [line.id, line]));
    const ids = new Set<number>();
    if (result.lines.length !== request.lines.length) throw new Error("原生对齐返回的歌词行不完整");
    for (const line of result.lines) {
      const original = originals.get(line.id);
      if (!original || ids.has(line.id)) throw new Error("原生对齐返回的歌词行无效");
      ids.add(line.id);
      for (const field of ["translation", "romanization"] as const) {
        const track = line[field];
        if (!track) continue;
        if (
          !request[field] ||
          track.parts.map((part) => part.text).join("") !== original[field] ||
          track.parts.some((part) => part.from > part.to || part.to >= original.words.length)
        )
          throw new Error("原生对齐改写了文本或返回越界范围");
      }
    }
    const timings = new Map(primary.map((line) => [line.id, line]));
    return {
      lines: [
        ...result.lines.map((line) => ({ ...line, ...timings.get(line.id) })),
        ...primary.filter((line) => !ids.has(line.id)),
      ],
      translationError: translationError ?? result.translationError,
    };
  } finally {
    environment?.release();
  }
};
