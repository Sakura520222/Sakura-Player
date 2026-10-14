import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  phase: "idle",
  set: vi.fn(),
  clear: vi.fn(),
  replaceAll: vi.fn(),
  sync: vi.fn(),
  syncDynamicIslandVisibility: vi.fn(),
  get: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock("electron", () => ({
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler),
  },
}));
vi.mock("@main/store", () => ({
  store: { get: mocks.get, set: mocks.set, clear: mocks.clear, replaceAll: mocks.replaceAll },
}));
vi.mock("@main/services/updater", () => ({
  getUpdateState: () => ({ phase: mocks.phase }),
  syncUpdateChannel: mocks.sync,
}));
vi.mock("@main/utils/logger", () => ({ systemLog: {} }));
vi.mock("@main/utils/config", () => ({ isWin: true }));
vi.mock("@main/utils/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@main/services/media", () => ({}));
vi.mock("@main/services/lastfm", () => ({}));
vi.mock("@main/services/engine", () => ({}));
vi.mock("@main/window", () => ({
  syncDynamicIslandVisibility: mocks.syncDynamicIslandVisibility,
}));
vi.mock("@main/server", () => ({}));
vi.mock("@main/services/mcp/http", () => ({}));
vi.mock("@main/services/orpheus", () => ({}));
vi.mock("@main/services/thumbnail", () => ({}));

import { registerConfigIpc } from "./config";

describe("更新配置入口", () => {
  beforeEach(() => {
    mocks.phase = "idle";
    mocks.handlers.clear();
    registerConfigIpc();
  });

  it.each([
    ["config:set", [null, "update.channel", "stable"], "set"],
    ["config:reset", [], "clear"],
    ["config:replaceAll", [null, { update: { channel: "beta" } }], "replaceAll"],
  ] as const)("%s 写入后同步更新器，安装启动中拒绝改动", (channel, args, method) => {
    const invoke = mocks.handlers.get(channel)!;
    invoke(...args);
    expect(mocks[method]).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks[method].mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sync.mock.invocationCallOrder[0],
    );
    mocks.phase = "installing";
    expect(() => invoke(...args)).toThrow("安装启动中");
    expect(mocks[method]).toHaveBeenCalledOnce();
  });

  it("非法通道不能写入配置", () => {
    expect(() => mocks.handlers.get("config:set")!(null, "update.channel", "invalid")).toThrow(
      "无效的更新通道",
    );
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("暂停隐藏开关写入后立即同步窗口并广播配置", () => {
    const config = { hideWhenPaused: true };
    mocks.get.mockReturnValue(config);
    mocks.handlers.get("config:set")!(null, "dynamicIsland.hideWhenPaused", true);
    expect(mocks.set).toHaveBeenCalledWith("dynamicIsland.hideWhenPaused", true);
    expect(mocks.syncDynamicIslandVisibility).toHaveBeenCalledOnce();
    expect(mocks.set.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.syncDynamicIslandVisibility.mock.invocationCallOrder[0],
    );
    expect(mocks.broadcast).toHaveBeenCalledWith("dynamicIsland:configChange", config);
  });

  it.each([
    ["config:reset", []],
    ["config:replaceAll", [null, { dynamicIsland: { hideWhenPaused: false } }]],
  ] as const)("%s 后重新应用暂停隐藏策略", (channel, args) => {
    mocks.handlers.get(channel)!(...args);
    expect(mocks.syncDynamicIslandVisibility).toHaveBeenCalledOnce();
  });
});
