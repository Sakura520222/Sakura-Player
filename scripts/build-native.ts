import { spawnSync } from "node:child_process";
import process from "node:process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";

interface NativeModule {
  name: string;
  enabled?: boolean;
}

const modules: NativeModule[] = [
  {
    name: "audio-engine",
  },
  {
    name: "audio-capture",
    enabled: process.platform === "win32" || process.platform === "linux",
  },
  {
    name: "media-ctrl",
  },
  {
    name: "taskbar-lyric",
    enabled: process.platform === "win32",
  },
  {
    name: "taskbar-thumbnail",
    enabled: process.platform === "win32",
  },
  {
    name: "opencc",
  },
];

const isRustAvailable = () => {
  const result = spawnSync("cargo", ["--version"], {
    stdio: "ignore",
  });

  return !result.error && !result.signal && result.status === 0;
};

if (process.env.SKIP_NATIVE_BUILD === "true" || process.env.SKIP_NATIVE_BUILD === "1") {
  console.log("[BuildNative] SKIP_NATIVE_BUILD 已设置，跳过原生模块构建");
  process.exit(0);
}

if (!isRustAvailable()) {
  console.error("[BuildNative] 错误：检测不到 Rust 工具链");
  console.error("[BuildNative] 未设置 SKIP_NATIVE_BUILD，因此必须包含 Rust 环境才能继续");
  console.error(
    "[BuildNative] 安装 Rust (https://rust-lang.org/tools/install/) 或者设置环境变量 SKIP_NATIVE_BUILD=true",
  );
  process.exit(1);
}

const parseArgs = () => {
  const options: {
    isDev: boolean;
    passing?: string[];
  } = {
    isDev: false,
  };

  const argv = process.argv;
  let index = 2;

  while (index < argv.length) {
    switch (argv[index]) {
      case "--dev": {
        options.isDev = true;
        index += 1;
        break;
      }
      case "--": {
        options.passing = argv.slice(index + 1);
        index = argv.length;
        break;
      }
      default: {
        console.error(`[BuildNative] 错误：未知参数 ${argv[index]}`);
        process.exit(1);
      }
    }
  }

  return options;
};

const napiArgs = ["--no-const-enum"];
const NAPI_BUILD_RETRY_LIMIT = 3;
const NAPI_BUILD_RETRY_DELAYS_MS = [1000, 3000, 7000];
const options = parseArgs();

// 对齐计算独占进程，以便取消时彻底回收模型和所有原生线程
const targetIndex = options.passing?.indexOf("--target") ?? -1;
let alignmentTarget =
  targetIndex >= 0 ? options.passing?.[targetIndex + 1] : process.env.CARGO_BUILD_TARGET;
if (!alignmentTarget) {
  const toolchain = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  alignmentTarget = /^host:\s*(\S+)/m.exec(toolchain.stdout ?? "")?.[1];
  if (toolchain.status !== 0 || !alignmentTarget) {
    console.error("[BuildNative] 无法确定原生工作进程的 Rust 目标平台");
    process.exit(1);
  }
}
const alignmentWindows = alignmentTarget.includes("windows");
const alignmentFlags =
  process.env.CARGO_ENCODED_RUSTFLAGS?.split("\x1f").filter(Boolean) ??
  process.env.RUSTFLAGS?.split(/\s+/).filter(Boolean) ??
  [];
// 仅工作进程静态链接 Windows CRT，不改变现有 NAPI 模块的编译环境
const alignmentEnv = alignmentWindows
  ? {
      ...process.env,
      CARGO_ENCODED_RUSTFLAGS: [...alignmentFlags, "-C", "target-feature=+crt-static"].join("\x1f"),
    }
  : process.env;
const alignment = spawnSync(
  "cargo",
  [
    "build",
    "--locked",
    "-p",
    "lyric-alignment",
    ...(options.isDev ? [] : ["--release"]),
    ...(alignmentTarget ? ["--target", alignmentTarget] : []),
  ],
  { stdio: "inherit", env: alignmentEnv },
);
if (alignment.error || alignment.status !== 0) {
  console.error("[BuildNative] 原生歌词对齐工作进程构建失败", alignment.error ?? alignment.status);
  process.exit(1);
}
const alignmentName = alignmentWindows ? "lyric-alignment.exe" : "lyric-alignment";
const alignmentDirectory = path.resolve("native/lyric-alignment/bin");
mkdirSync(alignmentDirectory, { recursive: true });
copyFileSync(
  path.join(
    process.env.CARGO_TARGET_DIR ?? "target",
    ...(alignmentTarget ? [alignmentTarget] : []),
    options.isDev ? "debug" : "release",
    alignmentName,
  ),
  path.join(alignmentDirectory, alignmentName),
);
if (process.platform !== "win32") chmodSync(path.join(alignmentDirectory, alignmentName), 0o755);

if (!options.isDev) napiArgs.push("--release");
if (options.passing) napiArgs.push(...options.passing);

for (const mod of modules) {
  if (mod.enabled === false) {
    continue;
  }
  const cwd = `native/${mod.name}`;

  const buildType = options.isDev ? "debug" : "release";
  console.log(`[BuildNative] 构建 ${mod.name} (${buildType})`);

  const spawnNapiBuild = () =>
    spawnSync("napi", ["build", ...napiArgs], {
      stdio: "inherit",
      shell: process.platform === "win32",
      cwd,
    });

  let result = spawnNapiBuild();
  let retries = 0;
  while (result.status !== 0 && retries < NAPI_BUILD_RETRY_LIMIT) {
    const delay = NAPI_BUILD_RETRY_DELAYS_MS[retries];
    retries += 1;
    console.log(
      `[BuildNative] ${mod.name} 构建失败，${delay}ms 后重试 (${retries}/${NAPI_BUILD_RETRY_LIMIT})`,
    );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    result = spawnNapiBuild();
  }

  if (result.error) {
    console.error("[BuildNative] 模块构建失败，进程启动失败", result.error);
    process.exit(1);
  }
  if (result.signal) {
    console.error("[BuildNative] 模块构建失败，进程被信号终止", result.signal);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("[BuildNative] 模块构建失败，进程异常退出", result.status);
    process.exit(result.status ?? 1);
  }
}
