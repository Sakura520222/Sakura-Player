import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({ data: "", download: vi.fn(), run: vi.fn() }));
vi.mock("@main/utils/paths", () => ({
  get dataRoot() {
    return mocks.data;
  },
  get lyricAlignmentRuntimeDir() {
    return path.join(mocks.data, "runtimes", "lyric-alignment");
  },
}));
vi.mock("./native", () => ({
  getAlignmentExecutable: () => path.join(mocks.data, "engine"),
  isAlignmentPlatformSupported: () => true,
}));
vi.mock("./download", () => ({ downloadAlignmentAsset: mocks.download }));
vi.mock("./process", () => ({ runAlignmentNative: mocks.run }));
vi.mock("./assets", async (original) => ({
  ...(await original<typeof import("./assets")>()),
  ALIGNMENT_MODEL_FILES: [
    {
      name: "model.safetensors",
      size: 7,
      sha256: createHash("sha256").update("weights").digest("hex"),
      url: "https://example.invalid/model",
    },
  ],
}));
let directory = "";
let environment: typeof import("./environment");
/** 返回本次测试独占的固定模型目录 */
const managed = (): string => path.join(mocks.data, "runtimes", "lyric-alignment");

beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(path.join(tmpdir(), "sakura-native-alignment-"));
  mocks.data = path.join(directory, "app-data");
  await mkdir(mocks.data);
  await writeFile(path.join(mocks.data, "engine"), "native");
  mocks.download
    .mockReset()
    .mockImplementation(async (_asset, destination: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      await writeFile(destination, "weights");
    });
  mocks.run.mockReset().mockResolvedValue('{"ready":true}');
  environment = await import("./environment");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("原生对齐模型事务", () => {
  it("读取状态不下载或启动进程，重复准备只验证一次", async () => {
    expect((await environment.getAlignmentEnvironmentStatus()).phase).toBe("not-installed");
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    const first = environment.installAlignmentEnvironment();
    const second = environment.installAlignmentEnvironment();
    expect((await first).installed).toBe(true);
    expect((await second).installed).toBe(true);
    expect(mocks.download).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(path.join(managed(), "ready.json"), "utf8"))).toMatchObject({
      version: 1,
      backend: "rust",
    });
    await environment.installAlignmentEnvironment();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("模型推理通过后才发布完成标记", async () => {
    mocks.run.mockImplementationOnce(async () => {
      await expect(stat(path.join(managed(), "ready.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect((await environment.getAlignmentEnvironmentStatus()).phase).toBe("verifying");
      return '{"ready":true}';
    });
    expect((await environment.installAlignmentEnvironment()).phase).toBe("ready");
  });
  it("校验完整模型时不重复下载，也不修改其他目录", async () => {
    await mkdir(path.join(managed(), "model"), { recursive: true });
    await writeFile(path.join(managed(), "model/model.safetensors"), "weights");
    for (const name of ["python", "venv", "cache"]) {
      await mkdir(path.join(managed(), name));
      await writeFile(path.join(managed(), name, "keep.txt"), "preserve");
    }
    await writeFile(path.join(managed(), "ready.json"), "{}");
    expect((await environment.getAlignmentEnvironmentStatus()).installed).toBe(false);
    expect((await environment.installAlignmentEnvironment()).installed).toBe(true);
    expect(mocks.download).not.toHaveBeenCalled();
    expect(await readFile(path.join(managed(), "model/model.safetensors"), "utf8")).toBe("weights");
    for (const name of ["python", "venv", "cache"])
      expect(await readFile(path.join(managed(), name, "keep.txt"), "utf8")).toBe("preserve");
  });
  it("同样长度但散列错误的模型必须重新下载", async () => {
    await mkdir(path.join(managed(), "model"), { recursive: true });
    await writeFile(path.join(managed(), "model/model.safetensors"), "corrupt");
    expect((await environment.installAlignmentEnvironment()).installed).toBe(true);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it("取消首次下载会清理部分目录，随后可以重试", async () => {
    mocks.download.mockImplementationOnce(
      (_asset, _destination, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
    );
    const pending = environment.installAlignmentEnvironment();
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalled());
    expect(environment.cancelAlignmentEnvironmentInstall()).toBe(true);
    expect((await pending).phase).toBe("not-installed");
    await expect(stat(managed())).rejects.toMatchObject({ code: "ENOENT" });
    expect((await environment.installAlignmentEnvironment()).installed).toBe(true);
  });
  it("模型验证失败时保留已有权重供重试", async () => {
    await mkdir(path.join(managed(), "model"), { recursive: true });
    await writeFile(path.join(managed(), "model/model.safetensors"), "weights");
    mocks.run.mockRejectedValueOnce(new Error("推理失败"));
    expect((await environment.installAlignmentEnvironment()).installed).toBe(false);
    expect(await readFile(path.join(managed(), "model/model.safetensors"), "utf8")).toBe("weights");
    expect(mocks.download).not.toHaveBeenCalled();
    expect((await environment.installAlignmentEnvironment()).installed).toBe(true);
  });
  it("完成标记不绑定绝对目录、操作系统或架构，便携移动后仍可使用模型", async () => {
    await environment.installAlignmentEnvironment();
    const marker = JSON.parse(await readFile(path.join(managed(), "ready.json"), "utf8"));
    expect(marker).not.toHaveProperty("root");
    expect(marker).not.toHaveProperty("platform");
    expect(marker).not.toHaveProperty("arch");
  });
  it("工作进程缺失时报告错误，不下载模型", async () => {
    await rm(path.join(mocks.data, "engine"));
    expect((await environment.installAlignmentEnvironment()).installed).toBe(false);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("运行期间阻止卸载，幂等释放后只清理专用目录", async () => {
    await environment.installAlignmentEnvironment();
    const lease = await environment.acquireAlignmentEnvironment();
    expect((await environment.getAlignmentEnvironmentStatus()).inUse).toBe(true);
    await expect(environment.uninstallAlignmentEnvironment()).rejects.toThrow("正在使用");
    const unrelated = path.join(mocks.data, "runtimes", "other.txt");
    await writeFile(unrelated, "preserve");
    lease.release();
    lease.release();
    expect((await environment.uninstallAlignmentEnvironment()).hasFiles).toBe(false);
    expect(await readFile(unrelated, "utf8")).toBe("preserve");
  });
  it("拒绝根目录或模型子目录链接，不能卸载其他位置", async () => {
    const external = path.join(directory, "external");
    await mkdir(external);
    await writeFile(path.join(external, "keep.txt"), "keep");
    await mkdir(managed(), { recursive: true });
    await symlink(
      external,
      path.join(managed(), "model"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect((await environment.uninstallAlignmentEnvironment()).phase).toBe("error");
    expect(await readFile(path.join(external, "keep.txt"), "utf8")).toBe("keep");
  });
  it("退出会取消下载并等待清理，之后拒绝新操作", async () => {
    mocks.download.mockImplementationOnce(
      (_asset, _destination, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
    );
    const pending = environment.installAlignmentEnvironment();
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalled());
    expect(environment.isAlignmentEnvironmentBusy()).toBe(true);
    await environment.shutdownAlignmentEnvironment();
    expect((await pending).hasFiles).toBe(false);
    expect(environment.isAlignmentEnvironmentBusy()).toBe(false);
    await expect(environment.installAlignmentEnvironment()).rejects.toThrow("退出");
  });
  it("退出会等待正在运行的对齐使用权释放", async () => {
    await environment.installAlignmentEnvironment();
    const lease = await environment.acquireAlignmentEnvironment();
    let finished = false;
    const shutdown = environment.shutdownAlignmentEnvironment().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    await expect(environment.acquireAlignmentEnvironment()).rejects.toThrow("退出");
    lease.release();
    await shutdown;
    expect(finished).toBe(true);
  });
});
