import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  setDefault: vi.fn(),
  removeDefault: vi.fn(),
  isDefault: vi.fn(),
  handlerName: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    setAsDefaultProtocolClient: mocks.setDefault,
    removeAsDefaultProtocolClient: mocks.removeDefault,
    isDefaultProtocolClient: mocks.isDefault,
    getApplicationNameForProtocol: mocks.handlerName,
  },
}));
vi.mock("@main/store", () => ({ store: { get: mocks.get } }));
vi.mock("@main/window", () => ({ getMainWindow: vi.fn(() => null) }));
vi.mock("@main/utils/logger", () => ({ coreLog: { info: mocks.info, warn: mocks.warn } }));

describe("共享 Orpheus 协议的注册边界", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("PORTABLE_EXECUTABLE_FILE", undefined);
    mocks.get.mockReturnValue(false);
    mocks.setDefault.mockReturnValue(true);
    mocks.removeDefault.mockReturnValue(true);
    mocks.isDefault.mockReturnValue(false);
    mocks.handlerName.mockReturnValue("");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("默认关闭时不注册协议", async () => {
    const { initOrpheusRegistration } = await import("./orpheus");
    initOrpheusRegistration();
    expect(mocks.setDefault).not.toHaveBeenCalled();
  });

  it("启动时保留上游或其他应用的默认处理器", async () => {
    mocks.get.mockReturnValue(true);
    mocks.handlerName.mockReturnValue("SPlayer-Next");
    const { initOrpheusRegistration } = await import("./orpheus");
    initOrpheusRegistration();
    expect(mocks.handlerName).toHaveBeenCalledWith("orpheus://");
    expect(mocks.setDefault).not.toHaveBeenCalled();
  });

  it("已开启且不存在默认处理器时注册原有协议", async () => {
    mocks.get.mockReturnValue(true);
    const { initOrpheusRegistration } = await import("./orpheus");
    initOrpheusRegistration();
    expect(mocks.setDefault).toHaveBeenCalledWith("orpheus", process.execPath);
  });

  it("用户主动开启时仍允许设置默认处理器", async () => {
    mocks.handlerName.mockReturnValue("SPlayer-Next");
    const { setOrpheusProtocolRegistered } = await import("./orpheus");
    setOrpheusProtocolRegistered(true);
    expect(mocks.setDefault).toHaveBeenCalledWith("orpheus", process.execPath);
  });

  it("取消注册不删除其他应用的默认处理器", async () => {
    const { setOrpheusProtocolRegistered } = await import("./orpheus");
    setOrpheusProtocolRegistered(false);
    expect(mocks.removeDefault).not.toHaveBeenCalled();
  });

  it("自身为默认处理器时才取消注册", async () => {
    mocks.isDefault.mockReturnValue(true);
    const { setOrpheusProtocolRegistered } = await import("./orpheus");
    setOrpheusProtocolRegistered(false);
    expect(mocks.removeDefault).toHaveBeenCalledWith("orpheus", process.execPath);
  });

  it("系统拒绝注册时不记录成功", async () => {
    mocks.setDefault.mockReturnValue(false);
    const { setOrpheusProtocolRegistered } = await import("./orpheus");
    setOrpheusProtocolRegistered(true);
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("系统拒绝取消注册时不记录成功", async () => {
    mocks.isDefault.mockReturnValue(true);
    mocks.removeDefault.mockReturnValue(false);
    const { setOrpheusProtocolRegistered } = await import("./orpheus");
    setOrpheusProtocolRegistered(false);
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.info).not.toHaveBeenCalled();
  });

  it("便携版注册和取消注册使用可移动的启动器路径", async () => {
    const launcher = "C:\\Players\\Sakura Player\\sakura-player-portable.exe";
    vi.stubEnv("PORTABLE_EXECUTABLE_FILE", launcher);
    mocks.isDefault.mockReturnValue(true);
    const { setOrpheusProtocolRegistered } = await import("./orpheus");
    setOrpheusProtocolRegistered(true);
    setOrpheusProtocolRegistered(false);
    expect(mocks.setDefault).toHaveBeenCalledWith("orpheus", launcher);
    expect(mocks.isDefault).toHaveBeenCalledWith("orpheus", launcher);
    expect(mocks.removeDefault).toHaveBeenCalledWith("orpheus", launcher);
  });
});
