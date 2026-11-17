import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { parseLyric } from "lyric-kit";
import type { LyricFormat } from "../shared/types/lyrics";
import type { AlignmentLanguage, AlignmentLineResult } from "../shared/types/lyricAlignment";
import { PRIMARY_ALIGNMENT_MARGIN_MS } from "../shared/constants/lyricAlignment";
import { parseExportTtml } from "../shared/utils/lyricTtml";

interface Sample {
  name: string;
  source: string;
  language: AlignmentLanguage;
  lyricPath?: string;
  format?: LyricFormat;
}

/** 将本地逐字参考降为逐行输入，测量声学覆盖率、边界误差、耗时和峰值内存 */
const main = async (): Promise<void> => {
  const [manifest, model, runtime, destination = "build/primary-alignment-benchmark"] =
    process.argv.slice(2);
  if (!manifest || !model || !runtime)
    throw new Error(
      "用法：tsx scripts/benchmark-primary-alignment.ts <样本清单.json> <模型目录> <ONNX运行库文件> [报告目录]",
    );
  const samples: Sample[] = JSON.parse(await readFile(manifest, "utf8"));
  if (!samples.length || samples.length > 20) throw new Error("一次验证需要 1 至 20 个样本");
  const directory = path.resolve(destination);
  await mkdir(directory, { recursive: true });
  const native = createRequire(import.meta.url)(
    path.resolve("native/audio-engine/audio-engine.node"),
  ) as typeof import("../native/audio-engine");
  const extension = process.platform === "win32" ? ".exe" : "";
  const worker = path.resolve(`native/lyric-alignment/bin/lyric-alignment${extension}`);
  const monitor = path.resolve(`target/debug/examples/measure${extension}`);
  const summaries: unknown[] = [];
  for (const [sampleId, sample] of samples.entries()) {
    const tags = sample.lyricPath ? undefined : await native.readTrackTags(sample.source);
    const content = sample.lyricPath ? await readFile(sample.lyricPath, "utf8") : tags?.lyrics;
    if (!content) throw new Error(`样本 ${sample.name} 没有歌词`);
    const format: LyricFormat | undefined =
      sample.format ?? (tags?.lyricData ? JSON.parse(tags.lyricData).format : undefined);
    const parsed =
      format === "ttml"
        ? parseExportTtml(content)
        : parseLyric({ content, format }, { extractMetadata: true });
    const reference = parsed.lines.filter(
      (line) =>
        !line.isBG &&
        line.words.length > 1 &&
        line.endTime > line.startTime &&
        line.endTime > line.startTime,
    );
    const input = path.join(directory, `${sampleId}.request.json`);
    const output = path.join(directory, `${sampleId}.result.json`);
    await writeFile(
      input,
      JSON.stringify({
        source: path.resolve(sample.source),
        offsetMs: 0,
        language: sample.language,
        lines: reference.map((line, id) => ({
          id,
          text: line.words.map((word) => word.word).join(""),
          startTime: Math.max(0, line.startTime - PRIMARY_ALIGNMENT_MARGIN_MS),
          endTime: line.endTime + PRIMARY_ALIGNMENT_MARGIN_MS,
        })),
      }),
    );
    const measurement = await new Promise<{ elapsedMs: number; peakWorkingSetBytes: number }>(
      (resolve, reject) => {
        const child = spawn(
          monitor,
          [
            worker,
            input,
            output,
            "--acoustic",
            "--model-dir",
            path.resolve(model),
            "--runtime",
            path.resolve(runtime),
          ],
          { windowsHide: true },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
          stdout = (stdout + String(chunk)).slice(-8192);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = (stderr + String(chunk)).slice(-8192);
        });
        child.once("error", reject);
        child.once("close", (code) => {
          if (code !== 0) reject(new Error(stderr || "验证进程失败"));
          else {
            try {
              resolve(JSON.parse(stdout));
            } catch (error) {
              reject(error);
            }
          }
        });
      },
    );
    const result: { lines: AlignmentLineResult[] } = JSON.parse(await readFile(output, "utf8"));
    const starts: number[] = [],
      ends: number[] = [];
    for (const line of result.lines) {
      if (!line.primary) continue;
      let cursor = 0;
      const words = reference[line.id].words.map((word) => {
        const from = cursor;
        cursor += word.word.length;
        return { ...word, from, to: cursor };
      });
      cursor = 0;
      for (const word of line.primary.words) {
        const from = cursor;
        cursor += word.word.length;
        const group = words.filter(
          (original) => original.to > from && original.from < cursor && original.word.trim(),
        );
        if (!group.length) continue;
        starts.push(Math.abs(word.startTime - group[0].startTime));
        ends.push(Math.abs(word.endTime - group.at(-1)!.endTime));
      }
    }
    const boundaries = Object.fromEntries(
      (
        [
          ["start", starts],
          ["end", ends],
        ] as const
      ).map(([key, errors]) => [
        key,
        {
          count: errors.length,
          meanMs: errors.length
            ? Math.round(errors.reduce((sum, value) => sum + value, 0) / errors.length)
            : null,
          within: Object.fromEntries(
            [100, 200, 500].map((limit) => [
              limit,
              errors.length
                ? Math.round(
                    (100 * errors.filter((error) => error <= limit).length) / errors.length,
                  )
                : null,
            ]),
          ),
        },
      ]),
    );
    const summary = {
      name: sample.name,
      language: sample.language,
      lines: reference.length,
      matched: result.lines.filter((line) => line.primary).length,
      warned: result.lines.filter((line) => line.primary?.warnings?.length).length,
      ...measurement,
      boundaries,
    };
    summaries.push(summary);
    console.log(JSON.stringify(summary));
  }
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(summaries, null, 2) + "\n");
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
