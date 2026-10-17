import { execFile, spawn } from "node:child_process";
import path from "node:path";

/**
 * 执行专用 Python 并有界收集输出，取消时等待整个进程树退出
 * @param executable - 主进程确定的专用解释器
 * @param args - 独立参数，不通过 shell 拼接
 * @param env - 仅供本次子进程使用的隔离环境
 * @param signal - 安装或对齐任务的取消信号
 * @param input - 可选的 JSON 输入
 * @param onOutput - 安装日志回调，存在时只保留尾部诊断
 * @returns 完整 JSON 输出或有界安装诊断
 */
export const runAlignmentPython = async (
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  input = "",
  onOutput?: (text: string) => void,
): Promise<string> => {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // 虚拟环境和包内测试资源可能超过 MAX_PATH，使用扩展路径而不修改系统注册表
    const command = process.platform === "win32" ? path.toNamespacedPath(executable) : executable;
    const parameters =
      process.platform === "win32"
        ? args.map((value) => (path.isAbsolute(value) ? path.toNamespacedPath(value) : value))
        : args;
    const child = spawn(command, ["-X", "utf8", ...parameters], {
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    let stdout = "",
      stderr = "";
    let failure: Error | undefined;
    let termination: Promise<void> | undefined;
    /** Windows 虚拟环境会派生真正的解释器，必须终止本次任务的整棵进程树 */
    const abort = (): void => {
      if (termination) return;
      termination = new Promise((done) => {
        if (process.platform === "win32" && child.pid) {
          execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () =>
            done(),
          );
        } else if (child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure = error as Error;
          }
          done();
        } else {
          done();
        }
      });
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (onOutput) {
        stdout = (stdout + chunk).slice(-8192);
        onOutput(chunk);
      } else if (stdout.length + chunk.length > 1024 * 1024) {
        failure = new Error("对齐输出超过大小限制");
        abort();
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4096);
      onOutput?.(chunk);
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.stdin.once("error", (error) => {
      failure = error;
      abort();
    });
    child.once("close", async (code) => {
      signal.removeEventListener("abort", abort);
      await termination;
      if (signal.aborted) reject(new Error("操作已取消"));
      else if (failure) reject(failure);
      else if (code !== 0) reject(new Error(stderr.trim() || stdout.trim() || "Python 运行失败"));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
};
