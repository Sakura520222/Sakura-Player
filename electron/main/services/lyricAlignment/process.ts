import { spawn } from "node:child_process";
import path from "node:path";

/**
 * 执行固定 Rust 工作进程，输出有界，取消时等待进程真正退出后释放模型使用权
 * @param executable - 播放器自带的可执行文件
 * @param args - 主进程决定的模型目录或验证参数
 * @param signal - 用户取消或应用退出信号
 * @param input - 有界 JSON 请求
 * @returns 工作进程完整 JSON 响应
 */
export const runAlignmentNative = async (
  executable: string,
  args: string[],
  signal: AbortSignal,
  input = "",
): Promise<string> => {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? path.toNamespacedPath(executable) : executable,
      args,
      {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, RAYON_NUM_THREADS: "2", TOKENIZERS_PARALLELISM: "false" },
      },
    );
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let failure: Error | undefined;
    /** 原生进程不派生解释器，终止进程即可回收本任务的线程和映射文件 */
    const abort = (): void => {
      child.kill();
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) {
        failure = new Error("对齐输出超过大小限制");
        abort();
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.stdin.once("error", (error) => {
      failure = error;
      abort();
    });
    child.once("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new Error("操作已取消"));
      else if (failure) reject(failure);
      else if (code !== 0) reject(new Error(stderr.trim() || "原生对齐工作进程运行失败"));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
};
