import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { c as createTar } from "tar";

const mocks = vi.hoisted(() => ({ data: "", archive: "", download: vi.fn(), run: vi.fn() }));
vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => mocks.data } }));
vi.mock("@main/utils/paths", () => ({
  get dataRoot() {
    return mocks.data;
  },
  get lyricAlignmentRuntimeDir() {
    return path.join(mocks.data, "runtimes", "lyric-alignment");
  },
}));
vi.mock("@main/utils/proxy", () => ({ getNetworkProxyUrl: () => null }));
vi.mock("./download", () => ({ downloadAlignmentAsset: mocks.download }));
vi.mock("./process", () => ({ runAlignmentPython: mocks.run }));
vi.mock("./assets", async (original) => ({
  ...(await original<typeof import("./assets")>()),
  ALIGNMENT_MODEL_FILES: [
    { name: "model.safetensors", size: 7, sha256: "fixture", url: "https://example.invalid/model" },
  ],
}));

let directory = "";
let environment: typeof import("./environment");

beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(path.join(tmpdir(), "sakura-managed-alignment-"));
  mocks.data = path.join(directory, "app-data");
  mocks.archive = path.join(directory, "python.tar.gz");
  const source = path.join(directory, "source");
  await mkdir(path.join(source, "python"), { recursive: true });
  await writeFile(path.join(source, "python", "python.exe"), "portable");
  await createTar({ cwd: source, file: mocks.archive, gzip: true }, ["python"]);
  mocks.download
    .mockReset()
    .mockImplementation(async (_asset, destination: string, signal: AbortSignal) => {
      signal.throwIfAborted();
      if (destination.endsWith("python.tar.gz")) await copyFile(mocks.archive, destination);
      else await writeFile(destination, "weights");
    });
  mocks.run.mockReset().mockImplementation(async (_executable, args: string[]) => {
    if (args.includes("venv")) {
      const executable = path.join(
        args.at(-1)!,
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, "python");
    }
    if (args.includes("--verify")) {
      await expect(
        stat(path.join(mocks.data, "runtimes", "lyric-alignment", "ready.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      return '{"ready":true}';
    }
    return "";
  });
  environment = await import("./environment");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("专用对齐环境的安装事务", () => {
  it("重复安装在检查阶段被取消时保留已就绪的环境", async () => {
    await environment.installAlignmentEnvironment();
    const repeated = environment.installAlignmentEnvironment();
    expect(environment.cancelAlignmentEnvironmentInstall()).toBe(true);
    expect((await repeated).installed).toBe(true);
    const lease = await environment.acquireAlignmentEnvironment();
    lease.release();
  });
  it("显式退出会取消安装并等待清理，关闭窗口查询不会取消任务", async () => {
    mocks.download.mockImplementationOnce(
      (_asset, _destination, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        }),
    );
    const installing = environment.installAlignmentEnvironment();
    await vi.waitFor(() => expect(mocks.download).toHaveBeenCalled());
    expect(environment.isAlignmentEnvironmentBusy()).toBe(true);
    await environment.shutdownAlignmentEnvironment();
    expect((await installing).phase).toBe("not-installed");
    expect(environment.isAlignmentEnvironmentBusy()).toBe(false);
    await expect(environment.installAlignmentEnvironment()).rejects.toThrow("退出");
    await expect(stat(path.join(mocks.data, "runtimes", "lyric-alignment"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("显式退出等待对齐使用权释放，期间拒绝新请求", async () => {
    await environment.installAlignmentEnvironment();
    const lease = await environment.acquireAlignmentEnvironment();
    let finished = false;
    const shutdown = environment.shutdownAlignmentEnvironment().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    await expect(environment.acquireAlignmentEnvironment()).rejects.toThrow("退出");
    await expect(environment.uninstallAlignmentEnvironment()).rejects.toThrow("退出");
    lease.release();
    await shutdown;
    expect(finished).toBe(true);
  });
  it("读取状态不下载，重复安装复用任务并在验证后发布 ready", async () => {
    expect((await environment.getAlignmentEnvironmentStatus()).phase).toBe("not-installed");
    expect(mocks.download).not.toHaveBeenCalled();
    const first = environment.installAlignmentEnvironment();
    const second = environment.installAlignmentEnvironment();
    expect((await first).installed).toBe(true);
    expect((await second).installed).toBe(true);
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls.filter(([, args]) => args.includes("--verify"))).toHaveLength(1);
    expect((await environment.getAlignmentEnvironmentStatus()).phase).toBe("ready");
    await environment.installAlignmentEnvironment();
    expect(mocks.download).toHaveBeenCalledTimes(2);
  });
  it("取消会清理部分目录，随后可从头安装", async () => {
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
    await expect(stat(path.join(mocks.data, "runtimes", "lyric-alignment"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await environment.installAlignmentEnvironment()).installed).toBe(true);
  });
  it("依赖或模型验证失败不会留下可用标记，支持重试", async () => {
    mocks.run.mockRejectedValueOnce(new Error("package download failed"));
    const failed = await environment.installAlignmentEnvironment();
    expect(failed).toMatchObject({ phase: "error", installed: false, hasFiles: false });
    expect(failed.error).toContain("package download failed");
    expect((await environment.installAlignmentEnvironment()).installed).toBe(true);
  });
  it("运行时阻止卸载，释放后只删除专用目录", async () => {
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
  it("拒绝通过目录链接卸载其他路径", async () => {
    const external = path.join(directory, "external");
    const managed = path.join(mocks.data, "runtimes", "lyric-alignment");
    await mkdir(external);
    await writeFile(path.join(external, "keep.txt"), "keep");
    await mkdir(path.dirname(managed), { recursive: true });
    await symlink(external, managed, process.platform === "win32" ? "junction" : "dir");
    expect((await environment.uninstallAlignmentEnvironment()).phase).toBe("error");
    expect(await readFile(path.join(external, "keep.txt"), "utf8")).toBe("keep");
  });
  it("不继承系统 Python、代理配置或全局模型缓存", () => {
    vi.stubEnv("PYTHONPATH", "outside");
    vi.stubEnv("PYTHONHOME", "outside");
    vi.stubEnv("HF_HOME", "outside");
    vi.stubEnv("PIP_INDEX_URL", "https://example.invalid");
    vi.stubEnv("HTTPS_PROXY", "http://example.invalid");
    const env = environment.getAlignmentProcessEnvironment();
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.PYTHONHOME).toBeUndefined();
    expect(env.PIP_INDEX_URL).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined();
    expect(env.HF_HOME).toBe(
      path.toNamespacedPath(path.join(mocks.data, "runtimes", "lyric-alignment", "cache")),
    );
    expect(env.PATH).toBe(process.env.PATH);
  });
});
