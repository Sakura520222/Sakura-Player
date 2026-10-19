import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

/**
 * 执行进程监测工具，传入结构化参数并收集有界测量结果
 * @param executable - 仓库构建的监测程序
 * @param args - 工作进程、输入文件、输出文件及模型目录
 * @returns 本次任务耗时和峰值工作集
 */
const measure = (
  executable: string,
  args: string[],
): Promise<{ elapsedMs: number; peakWorkingSetBytes: number; exitCode: number }> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let output = "";
    let error = "";
    child.stdout.on("data", (value: Buffer) => {
      output = (output + value).slice(-8192);
    });
    child.stderr.on("data", (value: Buffer) => {
      error = (error + value).slice(-8192);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(error || output || "对齐性能验证失败"));
      else {
        try {
          resolve(JSON.parse(output));
        } catch (failure) {
          reject(failure);
        }
      }
    });
  });

/** 使用固定迁移语料验证对齐结果，并分别测量三次独立进程的耗时和内存 */
const main = async (): Promise<void> => {
  const model = process.argv[2];
  if (!model) throw new Error("用法：pnpm benchmark:alignment <已下载的模型目录> [报告目录]");
  const directory = path.resolve(process.argv[3] ?? "build/lyric-alignment-benchmark");
  await mkdir(directory, { recursive: true });
  const fixture = JSON.parse(
    await readFile("native/lyric-alignment/tests/fixtures/semantic.json", "utf8"),
  );
  const compatibility = JSON.parse(
    await readFile("native/lyric-alignment/tests/fixtures/compatibility.json", "utf8"),
  );
  const romanization = {
    requestId: "romanization-benchmark",
    translation: false,
    romanization: true,
    lines: compatibility.cases
      .filter((entry: { operation: string }) => entry.operation === "tokenize")
      .map((entry: { args: unknown[] }, id: number) => ({
        ...(entry.args[0] as object),
        id,
        translation: "",
      })),
  };
  const extension = process.platform === "win32" ? ".exe" : "";
  const worker = path.resolve("native/lyric-alignment/bin/lyric-alignment" + extension);
  const monitor = path.resolve("target/debug/examples/measure" + extension);
  const runs: (Awaited<ReturnType<typeof measure>> & {
    workload: string;
    iteration: number;
    lineCount: number;
  })[] = [];
  for (const [workload, request] of [
    ["translation", fixture.request],
    ["romanization", romanization],
  ] as const) {
    const input = path.join(directory, workload + "-request.json");
    await writeFile(input, JSON.stringify(request));
    for (let iteration = 0; iteration < 3; iteration++) {
      const output = path.join(directory, `${workload}-${iteration}.json`);
      const metrics = await measure(monitor, [
        worker,
        input,
        output,
        "--model-dir",
        path.resolve(model),
      ]);
      const result = JSON.parse(await readFile(output, "utf8"));
      assert.equal(result.translationError, undefined);
      if (workload === "translation")
        assert.deepEqual(
          JSON.parse(
            JSON.stringify(result.lines, (key, value) => (key === "score" ? undefined : value)),
          ),
          JSON.parse(
            JSON.stringify(fixture.expected, (key, value) => (key === "score" ? undefined : value)),
          ),
        );
      const run = { workload, iteration, lineCount: request.lines.length, ...metrics };
      runs.push(run);
      console.log(JSON.stringify(run));
    }
  }
  await writeFile(
    path.join(directory, "report.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        sourceCommit: fixture.sourceCommit,
        measurements:
          "Process-tree RSS samples; Windows root process also uses the OS peak working set",
        runs,
      },
      null,
      2,
    ),
  );
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
