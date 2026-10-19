import path from "node:path";
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { dataRoot, lyricAlignmentRuntimeDir } from "@main/utils/paths";
import type { AlignmentEnvironmentState } from "@shared/types/lyricAlignment";
import {
  ALIGNMENT_ENVIRONMENT_VERSION,
  ALIGNMENT_MODEL_FILES,
  ALIGNMENT_MODEL_REVISION,
} from "./assets";
import { downloadAlignmentAsset } from "./download";
import { getAlignmentExecutable, isAlignmentPlatformSupported } from "./native";
import { runAlignmentNative } from "./process";

const root = path.resolve(lyricAlignmentRuntimeDir);
const modelDirectory = path.join(root, "model");
let users = 0;
let shuttingDown = false;
let shutdownPromise: Promise<void> | null = null;
let finishUsers: (() => void) | undefined;
let operation: {
  kind: "install" | "uninstall";
  controller: AbortController;
  promise: Promise<AlignmentEnvironmentState>;
} | null = null;
let listener: ((state: AlignmentEnvironmentState) => void) | undefined;
let lastProgress = 0;
let state: AlignmentEnvironmentState = {
  revision: 0,
  phase: "not-installed",
  installed: false,
  hasFiles: false,
  supported: isAlignmentPlatformSupported(),
  inUse: false,
  downloadedBytes: 0,
  totalBytes: 0,
  detail: "",
  error: "",
};

/**
 * 发布不可变模型状态，下载进度最多每 200 毫秒推送一次
 * @param patch - 本次状态变化
 * @param progress - 是否仅更新下载进度
 */
const publish = (patch: Partial<AlignmentEnvironmentState>, progress = false): void => {
  if (progress && Date.now() - lastProgress < 200) return;
  lastProgress = Date.now();
  state = { ...state, ...patch, inUse: users > 0, revision: state.revision + 1 };
  listener?.({ ...state });
};

/**
 * 注册唯一广播器，不保留渲染窗口引用
 * @param callback - IPC 层状态广播
 */
export const setAlignmentEnvironmentListener = (
  callback: (state: AlignmentEnvironmentState) => void,
): void => {
  listener = callback;
};

/** 校验固定目录及所有将访问的子目录，拒绝通过链接读写其他位置 */
const verifyManagedDirectory = async (): Promise<void> => {
  if (root !== path.resolve(dataRoot, "runtimes", "lyric-alignment"))
    throw new Error("模型目录超出播放器数据范围");
  for (const directory of [path.dirname(root), root, modelDirectory]) {
    try {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("模型目录不能是链接或普通文件");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
};

/** 删除已校验的本功能模型目录 */
const removeManagedDirectory = async (): Promise<void> => {
  await verifyManagedDirectory();
  await rm(root, { recursive: true, force: true });
};

/** 检查可移植的模型完成标记及文件长度，不启动工作进程或发起下载 */
const inspectEnvironment = async (): Promise<{ installed: boolean; hasFiles: boolean }> => {
  await verifyManagedDirectory();
  try {
    await stat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { installed: false, hasFiles: false };
    throw error;
  }
  try {
    const marker = z
      .object({
        version: z.literal(ALIGNMENT_ENVIRONMENT_VERSION),
        backend: z.literal("rust"),
        model: z.literal(ALIGNMENT_MODEL_REVISION),
      })
      .safeParse(JSON.parse(await readFile(path.join(root, "ready.json"), "utf8")));
    if (!marker.success || !(await stat(getAlignmentExecutable())).isFile())
      return { installed: false, hasFiles: true };
    for (const file of ALIGNMENT_MODEL_FILES) {
      const info = await lstat(path.join(modelDirectory, file.name));
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.size)
        return { installed: false, hasFiles: true };
    }
    return { installed: true, hasFiles: true };
  } catch {
    return { installed: false, hasFiles: true };
  }
};

/**
 * 获取模型状态，不自动下载或修改模型文件
 * @returns 当前模型准备状态
 */
export const getAlignmentEnvironmentStatus = async (): Promise<AlignmentEnvironmentState> => {
  if (operation) return { ...state };
  const revision = state.revision;
  try {
    const disk = await inspectEnvironment();
    if (!operation && revision === state.revision) {
      const phase = disk.installed ? "ready" : state.phase === "error" ? "error" : "not-installed";
      if (
        disk.installed !== state.installed ||
        disk.hasFiles !== state.hasFiles ||
        phase !== state.phase
      )
        publish({ ...disk, phase });
    }
  } catch (error) {
    if (!operation && revision === state.revision)
      publish({
        phase: "error",
        installed: false,
        hasFiles: true,
        error: error instanceof Error ? error.message : String(error),
      });
  }
  return { ...state };
};

/**
 * 校验已有模型，仅下载缺失或损坏文件，原生推理成功后原子发布完成标记
 * @param signal - 用户取消或应用退出信号
 * @returns 准备完成、取消或失败后的模型状态
 */
const prepareEnvironment = async (signal: AbortSignal): Promise<AlignmentEnvironmentState> => {
  let created = false;
  try {
    if (!isAlignmentPlatformSupported() || !(await stat(getAlignmentExecutable())).isFile())
      throw new Error("当前版本未包含可用的原生对齐工作进程");
    const existing = await inspectEnvironment();
    if (existing.installed) {
      publish({ ...existing, phase: "ready", error: "" });
      return { ...state };
    }
    signal.throwIfAborted();
    created = !existing.hasFiles;
    await mkdir(modelDirectory, { recursive: true });
    const total = ALIGNMENT_MODEL_FILES.reduce((sum, file) => sum + file.size, 0);
    let received = 0;
    publish({
      phase: "downloading-model",
      hasFiles: true,
      downloadedBytes: 0,
      totalBytes: total,
      error: "",
      detail: "",
    });
    for (const file of ALIGNMENT_MODEL_FILES) {
      signal.throwIfAborted();
      const destination = path.join(modelDirectory, file.name);
      let reusable = false;
      try {
        const info = await lstat(destination);
        if (info.isSymbolicLink() || !info.isFile()) throw new Error("模型文件不能是链接或目录");
        if (info.size === file.size) {
          const hash = createHash("sha256");
          for await (const chunk of createReadStream(destination)) {
            signal.throwIfAborted();
            hash.update(chunk);
          }
          reusable = hash.digest("hex") === file.sha256;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (!reusable)
        await downloadAlignmentAsset(file, destination, signal, (bytes) =>
          publish({ downloadedBytes: received + bytes }, true),
        );
      received += file.size;
      publish({ downloadedBytes: received }, true);
    }
    publish({ phase: "verifying", downloadedBytes: 0, totalBytes: 0, detail: "" });
    const verified = await runAlignmentNative(
      getAlignmentExecutable(),
      ["--model-dir", modelDirectory, "--verify"],
      signal,
    );
    if (JSON.parse(verified).ready !== true) throw new Error("原生模型推理验证失败");
    signal.throwIfAborted();
    await verifyManagedDirectory();
    const temporary = path.join(root, "ready.json.part");
    await writeFile(
      temporary,
      JSON.stringify({
        version: ALIGNMENT_ENVIRONMENT_VERSION,
        backend: "rust",
        model: ALIGNMENT_MODEL_REVISION,
      }),
    );
    signal.throwIfAborted();
    await rename(temporary, path.join(root, "ready.json"));
    publish({
      phase: "ready",
      installed: true,
      hasFiles: true,
      downloadedBytes: 0,
      totalBytes: 0,
      detail: "",
      error: "",
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    let disk = { installed: false, hasFiles: true };
    try {
      if (created) await removeManagedDirectory();
      else await rm(path.join(root, "ready.json.part"), { force: true });
      disk = await inspectEnvironment();
    } catch (cleanup) {
      message += `\n${cleanup instanceof Error ? cleanup.message : String(cleanup)}`;
    }
    publish({
      phase: disk.installed
        ? "ready"
        : signal.aborted && !disk.hasFiles
          ? "not-installed"
          : "error",
      ...disk,
      downloadedBytes: 0,
      totalBytes: 0,
      detail: "",
      error: signal.aborted && !disk.hasFiles ? "" : message.slice(-4096),
    });
  }
  return { ...state };
};

/** 下载或校验对齐模型，重复点击复用同一任务 */
export const installAlignmentEnvironment = async (): Promise<AlignmentEnvironmentState> => {
  if (shuttingDown) throw new Error("播放器正在退出");
  if (operation?.kind === "install") return operation.promise;
  if (operation || users) throw new Error("模型正在使用，请稍后再准备");
  const current = {
    kind: "install" as const,
    controller: new AbortController(),
    promise: Promise.resolve(state),
  };
  operation = current;
  publish({
    phase: "downloading-model",
    installed: false,
    error: "",
    detail: "",
    downloadedBytes: 0,
    totalBytes: 0,
  });
  current.promise = prepareEnvironment(current.controller.signal).finally(() => {
    if (operation === current) operation = null;
  });
  return current.promise;
};

/** 取消下载或验证，等待对应任务回收工作进程和部分文件 */
export const cancelAlignmentEnvironmentInstall = (): boolean => {
  if (operation?.kind !== "install" || operation.controller.signal.aborted) return false;
  publish({ phase: "cancelling", detail: "" });
  operation.controller.abort();
  return true;
};

/**
 * 手动移除本功能模型，计算或下载期间拒绝删除
 * @returns 移除后的模型状态
 */
export const uninstallAlignmentEnvironment = async (): Promise<AlignmentEnvironmentState> => {
  if (shuttingDown) throw new Error("播放器正在退出");
  if (operation || users) throw new Error("模型正在使用，请先结束任务");
  const current = {
    kind: "uninstall" as const,
    controller: new AbortController(),
    promise: Promise.resolve(state),
  };
  operation = current;
  publish({ phase: "uninstalling", installed: false, error: "", detail: "" });
  current.promise = (async () => {
    try {
      await removeManagedDirectory();
      publish({
        phase: "not-installed",
        installed: false,
        hasFiles: false,
        downloadedBytes: 0,
        totalBytes: 0,
        detail: "",
        error: "",
      });
    } catch (error) {
      publish({
        phase: "error",
        installed: false,
        hasFiles: true,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (operation === current) operation = null;
    }
    return { ...state };
  })();
  return current.promise;
};

/** 为整个对齐任务持有模型使用权，防止运行期间卸载映射文件 */
export const acquireAlignmentEnvironment = async () => {
  if (shuttingDown) throw new Error("播放器正在退出");
  if (operation) throw new Error("模型正在下载或卸载，请稍后再试");
  users++;
  publish({});
  let released = false;
  /** 幂等释放本次模型使用权，退出流程等待最后一个任务完成 */
  const release = (): void => {
    if (released) return;
    released = true;
    users--;
    if (users === 0) {
      finishUsers?.();
      finishUsers = undefined;
    }
    publish({});
  };
  try {
    if (!(await inspectEnvironment()).installed) throw new Error("请先下载或校验对齐模型");
    return { modelDirectory, release };
  } catch (error) {
    release();
    throw error;
  }
};

/** 判断关闭主窗口时是否需要继续后台模型维护 */
export const isAlignmentEnvironmentBusy = (): boolean => operation !== null;

/** 退出时拒绝新任务，取消维护并等待所有进程和使用权释放 */
export const shutdownAlignmentEnvironment = (): Promise<void> => {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  cancelAlignmentEnvironmentInstall();
  shutdownPromise = (async () => {
    await operation?.promise;
    if (users > 0)
      await new Promise<void>((resolve) => {
        finishUsers = resolve;
      });
  })();
  return shutdownPromise;
};
