import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userData: "",
  getPath: vi.fn(),
  setPath: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("electron", () => ({ app: { getPath: mocks.getPath, setPath: mocks.setPath } }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const fsMock = { ...actual, existsSync: mocks.existsSync, mkdirSync: mocks.mkdirSync };
  return { ...fsMock, default: fsMock };
});

describe("Fork 便携数据目录隔离", () => {
  const portableDir = path.resolve("portable", "音乐播放器");
  const sakuraData = path.join(portableDir, "SakuraPlayerData");
  const upstreamData = path.join(portableDir, "UserData");

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("PORTABLE_EXECUTABLE_DIR", undefined);
    mocks.userData = path.resolve("appData", "Sakura Player");
    mocks.getPath.mockImplementation(() => mocks.userData);
    mocks.setPath.mockImplementation((name: string, value: string) => {
      if (name === "userData") mocks.userData = value;
    });
    mocks.existsSync.mockReturnValue(false);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("安装版保留 Electron 数据路径，不创建便携目录", async () => {
    const paths = await import("./paths");
    expect(paths.dataRoot).toBe(path.join(mocks.userData, "app-data"));
    expect(mocks.setPath).not.toHaveBeenCalled();
    expect(mocks.mkdirSync).not.toHaveBeenCalled();
  });

  it("与上游同目录时，配置和 Chromium 会话均写入独立目录", async () => {
    vi.stubEnv("PORTABLE_EXECUTABLE_DIR", portableDir);
    mocks.existsSync.mockImplementation((candidate: string) => candidate === upstreamData);

    const paths = await import("./paths");
    expect(mocks.mkdirSync).toHaveBeenCalledExactlyOnceWith(sakuraData, { recursive: true });
    expect(mocks.setPath).toHaveBeenCalledWith("userData", sakuraData);
    expect(mocks.setPath).toHaveBeenCalledWith("sessionData", sakuraData);
    expect(paths.dataRoot).toBe(path.join(sakuraData, "app-data"));
    expect(paths.configDir).toBe(path.join(sakuraData, "app-data", "config"));
    expect(paths.databaseDir).toBe(path.join(sakuraData, "app-data", "database"));
    expect(paths.defaultCacheDir).toBe(path.join(sakuraData, "app-data", "cache"));
    expect(paths.logsDir).toBe(path.join(sakuraData, "app-data", "logs"));
    expect(paths.pluginsDir).toBe(path.join(sakuraData, "app-data", "plugins"));
    expect(mocks.existsSync).not.toHaveBeenCalledWith(upstreamData);
  });

  it("独立目录已存在时复用它，不退回上游目录", async () => {
    vi.stubEnv("PORTABLE_EXECUTABLE_DIR", portableDir);
    mocks.existsSync.mockReturnValue(true);

    const paths = await import("./paths");
    expect(paths.dataRoot).toBe(path.join(sakuraData, "app-data"));
    expect(mocks.mkdirSync).not.toHaveBeenCalled();
    expect(mocks.setPath).not.toHaveBeenCalledWith("userData", upstreamData);
  });
});
