import { app } from "electron";
import path from "node:path";
import { lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { dataRoot, lyricAlignmentRuntimeDir } from "@main/utils/paths";
import { getNetworkProxyUrl } from "@main/utils/proxy";
import type { AlignmentEnvironmentState } from "@shared/types/lyricAlignment";
import {
  ALIGNMENT_ENVIRONMENT_VERSION,
  ALIGNMENT_MODEL_FILES,
  ALIGNMENT_MODEL_REVISION,
  ALIGNMENT_PYTHON_VERSION,
  getAlignmentPythonDownload,
} from "./assets";
import { downloadAlignmentAsset } from "./download";
import { runAlignmentPython } from "./process";

const root = path.resolve(lyricAlignmentRuntimeDir);
const modelDirectory = path.join(root, "model");
const environmentPython = path.join(
  root,
  "venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
export const alignmentScript = app.isPackaged
  ? path.join(process.resourcesPath, "lyric-alignment", "align.py")
  : path.join(app.getAppPath(), "resources", "lyric-alignment", "align.py");
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
  supported: !!getAlignmentPythonDownload(),
  inUse: false,
  downloadedBytes: 0,
  totalBytes: 0,
  detail: "",
  error: "",
};

/**
 * 发布不可变状态快照，下载进度最多每 200 毫秒推送一次
 * @param patch - 本次阶段或进度变化
 * @param progress - 是否仅为高频进度
 */
const publish = (patch: Partial<AlignmentEnvironmentState>, progress = false): void => {
  if (progress && Date.now() - lastProgress < 200) return;
  lastProgress = Date.now();
  state = { ...state, ...patch, inUse: users > 0, revision: state.revision + 1 };
  listener?.({ ...state });
};

/**
 * 注册主进程唯一的状态广播器，不保留渲染窗口引用
 * @param callback - IPC 层的状态广播
 */
export const setAlignmentEnvironmentListener = (
  callback: (state: AlignmentEnvironmentState) => void,
): void => {
  listener = callback;
};

/** 确认递归清理只作用于数据目录内的固定专用目录，拒绝目录链接 */
const verifyManagedDirectory = async (): Promise<void> => {
  if (root !== path.resolve(dataRoot, "runtimes", "lyric-alignment"))
    throw new Error("环境目录超出播放器数据范围");
  for (const directory of [path.dirname(root), root]) {
    try {
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error("环境目录不能是链接或普通文件");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
};

/** 删除固定专用环境，原有系统 Python、全局模型缓存与歌词文件均不在此目录 */
const removeManagedDirectory = async (): Promise<void> => {
  await verifyManagedDirectory();
  await rm(root, { recursive: true, force: true });
};

/**
 * 构造独立解释器环境，用户的 Python 路径、包配置和全局模型缓存不会参与
 * @returns 子进程专用的环境变量
 */
export const getAlignmentProcessEnvironment = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      /^(?:PYTHON|PIP_|HF_|HUGGINGFACE_|TRANSFORMERS_|UV_|VIRTUAL_ENV$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$)/i.test(
        name,
      )
    )
      delete env[name];
  }
  const temporary =
    process.platform === "win32"
      ? path.toNamespacedPath(path.join(root, "tmp"))
      : path.join(root, "tmp");
  const cache =
    process.platform === "win32"
      ? path.toNamespacedPath(path.join(root, "cache"))
      : path.join(root, "cache");
  return {
    ...env,
    PYTHONIOENCODING: "utf-8",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
    PIP_CONFIG_FILE: process.platform === "win32" ? "NUL" : "/dev/null",
    HF_HOME: cache,
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HF_HUB_DISABLE_TELEMETRY: "1",
    TOKENIZERS_PARALLELISM: "false",
    TMP: temporary,
    TEMP: temporary,
    TMPDIR: temporary,
  };
};

/**
 * 检查完成标记及必要文件，未完成安装和移动后的虚拟环境不视为可用
 * @returns 当前磁盘上的环境完整状态
 */
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
        python: z.literal(ALIGNMENT_PYTHON_VERSION),
        model: z.literal(ALIGNMENT_MODEL_REVISION),
        root: z.literal(root),
        platform: z.literal(process.platform),
        arch: z.literal(process.arch),
      })
      .safeParse(JSON.parse(await readFile(path.join(root, "ready.json"), "utf8")));
    if (!marker.success) return { installed: false, hasFiles: true };
    const executable = await stat(environmentPython);
    if (!executable.isFile()) return { installed: false, hasFiles: true };
    for (const file of ALIGNMENT_MODEL_FILES) {
      const info = await stat(path.join(modelDirectory, file.name));
      if (!info.isFile() || info.size !== file.size) return { installed: false, hasFiles: true };
    }
    return { installed: true, hasFiles: true };
  } catch {
    return { installed: false, hasFiles: true };
  }
};

/**
 * 获取状态时只检查本地文件，不自动下载、启动 Python 或安装依赖
 * @returns 可直接用于界面的环境快照
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
 * 仅由安装操作执行完整准备，完成校验后才写入 ready 标记
 * @param signal - 用户取消和应用退出的信号
 * @returns 安装后的状态，失败时返回诊断并清理部分文件
 */
const prepareEnvironment = async (signal: AbortSignal): Promise<AlignmentEnvironmentState> => {
  let ownsDirectory = false;
  try {
    const asset = getAlignmentPythonDownload();
    if (!asset) throw new Error("当前平台暂无可用的本地对齐环境");
    const existing = await inspectEnvironment();
    signal.throwIfAborted();
    if (existing.installed) {
      publish({ ...existing, phase: "ready", error: "" });
      return { ...state };
    }
    await removeManagedDirectory();
    ownsDirectory = true;
    await mkdir(root, { recursive: true });
    const temporary = path.join(root, "tmp");
    await mkdir(temporary);
    const archive = path.join(temporary, "python.tar.gz");
    publish({
      phase: "downloading-python",
      hasFiles: true,
      downloadedBytes: 0,
      totalBytes: asset.size,
      error: "",
      detail: "",
    });
    await downloadAlignmentAsset(asset, archive, signal, (downloadedBytes) =>
      publish({ downloadedBytes }, true),
    );
    signal.throwIfAborted();
    publish({ phase: "extracting-python", downloadedBytes: 0, totalBytes: 0, detail: "" });
    const tar = await import("tar");
    const extract = tar.x({
      cwd: root,
      strict: true,
      preservePaths: false,
      filter: (name, entry) => {
        const member = entry as import("tar").ReadEntry;
        const normalized = name.replace(/\\/g, "/");
        if (
          (normalized !== "python" && !normalized.startsWith("python/")) ||
          normalized.split("/").includes("..") ||
          normalized.includes(":")
        )
          throw new Error("Python 压缩包路径无效");
        if (member.type === "SymbolicLink" || member.type === "Link") {
          if (
            !member.linkpath ||
            path.posix.isAbsolute(member.linkpath) ||
            member.linkpath.includes(":")
          )
            throw new Error("Python 压缩包链接无效");
          const target = path.posix.resolve(
            member.type === "Link" ? "/" : path.posix.dirname(`/${normalized}`),
            member.linkpath.replace(/\\/g, "/"),
          );
          if (!target.startsWith("/python/")) throw new Error("Python 压缩包包含越界链接");
        }
        return true;
      },
    });
    await pipeline(createReadStream(archive), extract, { signal });
    signal.throwIfAborted();
    publish({ phase: "creating-environment", detail: "" });
    const portablePython = path.join(
      root,
      "python",
      process.platform === "win32" ? "python.exe" : "bin/python3",
    );
    const env = getAlignmentProcessEnvironment();
    await runAlignmentPython(
      portablePython,
      ["-I", "-m", "venv", "--without-pip", "--copies", path.join(root, "venv")],
      env,
      signal,
    );
    publish({ phase: "installing-dependencies", detail: "" });
    await runAlignmentPython(
      environmentPython,
      ["-I", "-m", "ensurepip", "--upgrade", "--default-pip"],
      env,
      signal,
    );
    const proxy = getNetworkProxyUrl();
    // pip 的 SOCKS 传输依赖 PySocks，先通过应用自己的代理下载并离线安装
    if (proxy?.startsWith("socks5://")) {
      const socksWheel = path.join(temporary, "PySocks-1.7.1-py3-none-any.whl");
      await downloadAlignmentAsset(
        {
          url: "https://files.pythonhosted.org/packages/8d/59/b4572118e098ac8e46e399a1dd0f2d85403ce8bbaad9ec79373ed6badaf9/PySocks-1.7.1-py3-none-any.whl",
          size: 16725,
          sha256: "2725bd0a9925919b9b51739eea5f9e2bae91e83288108a9ad338b2e3a4435ee5",
        },
        socksWheel,
        signal,
        () => {},
      );
      await runAlignmentPython(
        environmentPython,
        ["-I", "-m", "pip", "--isolated", "install", "--no-index", "--no-cache-dir", socksWheel],
        env,
        signal,
      );
    }
    const pip = [
      "-I",
      "-m",
      "pip",
      "--isolated",
      "install",
      "--no-input",
      "--disable-pip-version-check",
      "--no-cache-dir",
      "--only-binary=:all:",
      ...(proxy ? ["--proxy", proxy] : []),
    ];
    /** 将安装输出压缩成一行有界诊断，界面无需展示命令或填写路径 */
    const progress = (text: string): void => {
      const detail =
        text
          // eslint-disable-next-line no-control-regex -- 安装日志可能包含 ANSI 控制序列
          .replace(/\u001b\[[0-9;]*m/g, "")
          .trim()
          .split(/[\r\n]+/)
          .at(-1)
          ?.slice(0, 240) ?? "";
      if (detail) publish({ detail }, true);
    };
    const mac = process.platform === "darwin";
    await runAlignmentPython(
      environmentPython,
      [
        ...pip,
        "--index-url",
        mac ? "https://pypi.org/simple" : "https://download.pytorch.org/whl/cpu",
        mac ? "torch==2.2.2" : "torch==2.14.1",
      ],
      env,
      signal,
      "",
      progress,
    );
    await runAlignmentPython(
      environmentPython,
      [
        ...pip,
        "--index-url",
        "https://pypi.org/simple",
        "-r",
        path.join(path.dirname(alignmentScript), "requirements.txt"),
      ],
      env,
      signal,
      "",
      progress,
    );
    await mkdir(modelDirectory);
    const total = ALIGNMENT_MODEL_FILES.reduce((sum, file) => sum + file.size, 0);
    let received = 0;
    publish({ phase: "downloading-model", downloadedBytes: 0, totalBytes: total, detail: "" });
    for (const file of ALIGNMENT_MODEL_FILES) {
      await downloadAlignmentAsset(file, path.join(modelDirectory, file.name), signal, (bytes) =>
        publish({ downloadedBytes: received + bytes }, true),
      );
      received += file.size;
    }
    publish({ phase: "verifying", downloadedBytes: 0, totalBytes: 0, detail: "" });
    const verified = await runAlignmentPython(
      environmentPython,
      ["-I", "-u", alignmentScript, "--model-dir", modelDirectory, "--verify"],
      env,
      signal,
    );
    if (JSON.parse(verified).ready !== true) throw new Error("模型加载验证失败");
    signal.throwIfAborted();
    await writeFile(
      path.join(root, "ready.json"),
      JSON.stringify({
        version: ALIGNMENT_ENVIRONMENT_VERSION,
        python: ALIGNMENT_PYTHON_VERSION,
        model: ALIGNMENT_MODEL_REVISION,
        root,
        platform: process.platform,
        arch: process.arch,
      }),
      { flag: "wx" },
    );
    await verifyManagedDirectory();
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary);
    signal.throwIfAborted();
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
      if (ownsDirectory) await removeManagedDirectory();
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
      error: disk.installed || (signal.aborted && !disk.hasFiles) ? "" : message.slice(-4096),
    });
  }
  return { ...state };
};

/**
 * 由用户点击发起安装，重复点击复用同一任务
 * @returns 完成、失败或取消后的环境状态
 */
export const installAlignmentEnvironment = async (): Promise<AlignmentEnvironmentState> => {
  if (shuttingDown) throw new Error("播放器正在退出");
  if (operation?.kind === "install") return operation.promise;
  if (operation || users) throw new Error("环境正在使用，请稍后再安装");
  const current = {
    kind: "install" as const,
    controller: new AbortController(),
    promise: Promise.resolve(state),
  };
  operation = current;
  publish({
    phase: "downloading-python",
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

/**
 * 取消正在进行的安装，等待任务本身回收进程和文件
 * @returns 是否存在可取消的安装任务
 */
export const cancelAlignmentEnvironmentInstall = (): boolean => {
  if (operation?.kind !== "install" || operation.controller.signal.aborted) return false;
  publish({ phase: "cancelling", detail: "" });
  operation.controller.abort();
  return true;
};

/**
 * 卸载播放器专用环境，运行中或安装中不会删除任何文件
 * @returns 卸载后的状态或清理失败的诊断
 */
export const uninstallAlignmentEnvironment = async (): Promise<AlignmentEnvironmentState> => {
  if (shuttingDown) throw new Error("播放器正在退出");
  if (operation || users) throw new Error("环境正在使用，请先结束任务");
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

/**
 * 为对齐持有环境使用权，避免执行期间被卸载
 * @returns 专用解释器、模型目录和必须在 finally 中调用的释放操作
 */
export const acquireAlignmentEnvironment = async () => {
  if (shuttingDown) throw new Error("播放器正在退出");
  if (operation) throw new Error("环境正在安装或卸载，请稍后再试");
  users++;
  publish({});
  let released = false;
  /** 释放本次使用权，重复调用不会改变其他任务的状态 */
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
    const disk = await inspectEnvironment();
    if (!disk.installed) throw new Error("请先点击安装对齐环境");
    return {
      python: environmentPython,
      modelDirectory,
      env: getAlignmentProcessEnvironment(),
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
};

/**
 * 判断关闭主窗口时是否应保留后台安装或卸载任务
 * @returns 是否仍有环境维护任务正在执行
 */
export const isAlignmentEnvironmentBusy = (): boolean => operation !== null;

/** 退出应用时停止接收新任务，并等待安装进程和临时文件清理完毕 */
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
