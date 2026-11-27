import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  phase: "idle",
  set: vi.fn(),
  clear: vi.fn(),
  replaceAll: vi.fn(),
  sync: vi.fn(),
  syncDynamicIslandVisibility: vi.fn(),
  applyDesktopLyricAlwaysOnTop: vi.fn(),
  applyDynamicIslandAlwaysOnTop: vi.fn(),
  syncCompanion: vi.fn(),
  get: vi.fn(),
  broadcast: vi.fn(),
  refreshPowerBlocker: vi.fn(),
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
vi.mock("@main/utils/powerBlocker", () => ({ refreshPowerBlocker: mocks.refreshPowerBlocker }));
vi.mock("@main/utils/config", () => ({ isWin: true }));
vi.mock("@main/utils/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@main/services/companion", () => ({ syncCompanionConfig: mocks.syncCompanion }));
vi.mock("@main/services/media", () => ({}));
vi.mock("@main/services/lastfm", () => ({}));
vi.mock("@main/services/engine", () => ({}));
vi.mock("@main/window", () => ({
  syncDynamicIslandVisibility: mocks.syncDynamicIslandVisibility,
  applyDesktopLyricAlwaysOnTop: mocks.applyDesktopLyricAlwaysOnTop,
  applyDynamicIslandAlwaysOnTop: mocks.applyDynamicIslandAlwaysOnTop,
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
  ] as const)("%s 后重新应用暂停隐藏、置顶、陪伴广播与电源策略", (channel, args) => {
    const companion = { enabled: false, showAvatar: true };
    const desktopLyric = { alwaysOnTop: true };
    const dynamicIsland = { alwaysOnTop: false };
    mocks.get.mockImplementation(
      (key: string) =>
        ({
          companion,
          desktopLyric,
          dynamicIsland,
          "desktopLyric.alwaysOnTop": desktopLyric.alwaysOnTop,
          "dynamicIsland.alwaysOnTop": dynamicIsland.alwaysOnTop,
        })[key],
    );
    mocks.broadcast.mockClear();
    mocks.applyDesktopLyricAlwaysOnTop.mockClear();
    mocks.applyDynamicIslandAlwaysOnTop.mockClear();
    mocks.handlers.get(channel)!(...args);
    expect(mocks.syncDynamicIslandVisibility).toHaveBeenCalledOnce();
    expect(mocks.applyDesktopLyricAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.applyDynamicIslandAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(false);
    expect(mocks.refreshPowerBlocker).toHaveBeenCalledOnce();
    expect(mocks.syncCompanion).toHaveBeenCalledOnce();
    expect(mocks.broadcast).toHaveBeenCalledWith("companion:configChange", companion);
    expect(mocks.broadcast).toHaveBeenCalledWith("desktopLyric:configChange", desktopLyric);
    expect(mocks.broadcast).toHaveBeenCalledWith("dynamicIsland:configChange", dynamicIsland);
  });

  it.each([
    ["companion.replyBubble", false],
    ["companion.replyBubbleSeconds", 13],
  ])("修改 %s 后通知陪伴窗口重新读取配置", (keyPath, value) => {
    mocks.handlers.get("config:set")!(null, keyPath, value);
    expect(mocks.set).toHaveBeenCalledWith(keyPath, value);
    expect(mocks.syncCompanion).toHaveBeenCalledWith(keyPath);
    expect(mocks.set.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.syncCompanion.mock.invocationCallOrder[0],
    );
  });

  it("屏幕常亮开关写入后立即刷新电源策略", () => {
    mocks.handlers.get("config:set")!(null, "player.keepScreenAwake", true);
    expect(mocks.set).toHaveBeenCalledWith("player.keepScreenAwake", true);
    expect(mocks.refreshPowerBlocker).toHaveBeenCalledOnce();
    expect(mocks.set.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refreshPowerBlocker.mock.invocationCallOrder[0],
    );
  });
});
