import { z } from "zod";
import type { AlignmentLineResult, LocalAlignmentRequest } from "@shared/types/lyricAlignment";
import { getCurrentAudioRange } from "../playerPreload";
import { lightSnapshot } from "../nowPlaying";
import { acquireAlignmentEnvironment } from "./environment";
import { acousticRuntimePath } from "./acousticRuntime";
import { getAlignmentExecutable } from "./native";
import { runAlignmentNative } from "./process";
import { PRIMARY_ALIGNMENT_MARGIN_MS } from "@shared/constants/lyricAlignment";

export const primaryResultSchema = z.object({
  words: z
    .array(
      z.object({
        word: z.string().max(2048),
        startTime: z.number().nonnegative(),
        endTime: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(2048),
  score: z.number().min(0).max(1),
  warnings: z.array(z.string().max(4096)).max(16).optional(),
});

/**
 * 从主进程当前音源计算主歌词时间，渲染端不能提交文件或模型路径
 * @param request - 已校验的行级歌词和歌曲身份
 * @param signal - 当前任务取消信号
 * @returns 保留原文的逐字候选与逐行失败原因
 */
export const runPrimaryAlignment = async (
  request: LocalAlignmentRequest,
  signal: AbortSignal,
): Promise<AlignmentLineResult[]> => {
  const source = getCurrentAudioRange();
  const snapshot = lightSnapshot();
  if (
    !request.primary ||
    snapshot.track?.id !== request.primary.trackId ||
    source?.trackId !== request.primary.trackId ||
    !source?.source ||
    source.source.includes("://")
  )
    throw new Error("主歌词对齐需要当前已加载的本地或完整缓存音源");
  const duration = source.endMs - source.startMs;
  const lines = request.lines
    .filter((line) => line.primary)
    .map((line) => ({
      ...line,
      primary: { ...line.primary!, endTime: Math.min(line.primary!.endTime, duration) },
    }));
  if (!lines.length) return [];
  if (
    request.lines.some(
      (line) =>
        line.primary &&
        (line.primary.startTime >= duration ||
          line.primary.endTime > duration + PRIMARY_ALIGNMENT_MARGIN_MS),
    )
  )
    throw new Error("歌词时间超出当前曲目范围");
  const environment = await acquireAlignmentEnvironment("acoustic");
  try {
    signal.throwIfAborted();
    const output = await runAlignmentNative(
      getAlignmentExecutable(),
      ["--acoustic", "--model-dir", environment.modelDirectory, "--runtime", acousticRuntimePath()],
      signal,
      JSON.stringify({
        source: source.source,
        offsetMs: source.startMs,
        language: request.primary.language,
        lines: lines.map((line) => ({ id: line.id, text: line.words.join(""), ...line.primary })),
      }),
    );
    signal.throwIfAborted();
    if (
      getCurrentAudioRange()?.source !== source.source ||
      lightSnapshot().track?.id !== request.primary.trackId
    )
      throw new Error("歌曲已经变化，请重新开始对齐");
    const result = z
      .object({
        lines: z
          .array(
            z.object({
              id: z.number().int().nonnegative(),
              primary: primaryResultSchema.optional(),
              reason: z.string().max(4096).optional(),
            }),
          )
          .max(1000),
      })
      .parse(JSON.parse(output));
    const seen = new Set<number>();
    if (result.lines.length !== lines.length) throw new Error("声学结果缺行");
    for (const line of result.lines) {
      const original = lines.find((source) => source.id === line.id);
      if (!original || seen.has(line.id)) throw new Error("声学结果行号无效");
      seen.add(line.id);
      if (!line.primary) continue;
      const words = line.primary.words;
      if (
        words.map((word) => word.word).join("") !== original.words.join("") ||
        words.some(
          (word, index) =>
            word.endTime <= word.startTime ||
            word.startTime < original.primary!.startTime ||
            word.endTime > original.primary!.endTime ||
            (index > 0 && word.startTime < words[index - 1].endTime),
        )
      )
        throw new Error("声学结果改写了原文或时间无效");
    }
    return result.lines;
  } finally {
    environment.release();
  }
};
