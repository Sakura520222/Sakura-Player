import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAlignmentNative } from "./process";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "sakura-alignment-process-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("对齐工作进程资源边界", () => {
  it("保持 UTF-8 输入输出，不增加解释器参数或依赖系统模型路径", async () => {
    const output = await runAlignmentNative(
      process.execPath,
      [
        "-e",
        "process.stdin.setEncoding('utf8');let text='';process.stdin.on('data',value=>text+=value);process.stdin.on('end',()=>process.stdout.write(text));",
      ],
      new AbortController().signal,
      '{"text":"君の夢 🎵"}',
    );
    expect(JSON.parse(output)).toEqual({ text: "君の夢 🎵" });
  });
  it("按字节限制多字节输出，超限会终止工作进程", async () => {
    await expect(
      runAlignmentNative(
        process.execPath,
        ["-e", "process.stdout.write('中'.repeat(400000));"],
        new AbortController().signal,
      ),
    ).rejects.toThrow("大小限制");
  });
  it("错误只保留末尾有界诊断", async () => {
    const error = await runAlignmentNative(
      process.execPath,
      ["-e", "process.stderr.write('x'.repeat(20000)+'模型失败');process.exitCode=2;"],
      new AbortController().signal,
    ).catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("模型失败");
    expect((error as Error).message.length).toBeLessThanOrEqual(4096);
  });
  it("取消会等待真实进程退出，返回后不存在遗留进程", async () => {
    const pidFile = path.join(directory, "pid.txt");
    const controller = new AbortController();
    const pending = runAlignmentNative(
      process.execPath,
      [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);",
        pidFile,
      ],
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow("取消");
    let pid = 0;
    await vi.waitFor(async () => {
      pid = Number(await readFile(pidFile, "utf8"));
      expect(pid).toBeGreaterThan(0);
    });
    controller.abort();
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it("预先取消和工作进程缺失均立即报告错误", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runAlignmentNative(process.execPath, [], controller.signal)).rejects.toThrow();
    await expect(
      runAlignmentNative(path.join(directory, "missing.exe"), [], new AbortController().signal),
    ).rejects.toThrow();
  });
});
