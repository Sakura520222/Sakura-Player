import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false,
  active: new Map<number, string>(),
  start: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("electron", () => ({ powerSaveBlocker: { start: mocks.start, stop: mocks.stop } }));
vi.mock("@main/store", () => ({ store: { get: () => mocks.enabled } }));
vi.mock("./logger", () => ({ systemLog: { info: vi.fn() } }));

import {
  refreshPowerBlocker,
  releasePowerBlocker,
  setMainWindowVisible,
  setPlayerExpanded,
  updatePowerBlocker,
} from "./powerBlocker";

describe("播放与屏幕电源策略", () => {
  beforeEach(() => {
    releasePowerBlocker();
    vi.clearAllMocks();
    mocks.enabled = false;
    mocks.active.clear();
    let nextId = 0;
    mocks.start.mockImplementation((type: string) => {
      const id = nextId++;
      mocks.active.set(id, type);
      return id;
    });
    mocks.stop.mockImplementation((id: number) => mocks.active.delete(id));
  });

  it("默认只阻止音频休眠，屏幕常亮需要用户开启", () => {
    setPlayerExpanded(true);
    setMainWindowVisible(true);
    updatePowerBlocker("playing");
    expect([...mocks.active.values()]).toEqual(["prevent-app-suspension"]);
    mocks.enabled = true;
    refreshPowerBlocker();
    expect([...mocks.active.values()]).toEqual(["prevent-app-suspension", "prevent-display-sleep"]);
    mocks.enabled = false;
    refreshPowerBlocker();
    expect([...mocks.active.values()]).toEqual(["prevent-app-suspension"]);
  });

  it("收起或隐藏播放页时只释放屏幕常亮，恢复后重新申请", () => {
    mocks.enabled = true;
    setPlayerExpanded(true);
    setMainWindowVisible(true);
    updatePowerBlocker("playing");
    setPlayerExpanded(false);
    expect([...mocks.active.values()]).toEqual(["prevent-app-suspension"]);
    setPlayerExpanded(true);
    expect(mocks.active.size).toBe(2);
    setMainWindowVisible(false);
    expect([...mocks.active.values()]).toEqual(["prevent-app-suspension"]);
    setMainWindowVisible(true);
    expect(mocks.active.size).toBe(2);
  });

  it("缓冲期间仅保留音频防休眠，正在播放时才保持屏幕常亮", () => {
    mocks.enabled = true;
    setPlayerExpanded(true);
    setMainWindowVisible(true);
    updatePowerBlocker("loading");
    expect([...mocks.active.values()]).toEqual(["prevent-app-suspension"]);
    updatePowerBlocker("playing");
    expect(mocks.active.size).toBe(2);
    updatePowerBlocker("loading");
    expect([...mocks.active.values()]).toEqual(["prevent-app-suspension"]);
  });

  it.each(["paused", "stopped", "idle"] as const)("%s 状态释放全部电源抑制", (state) => {
    mocks.enabled = true;
    setPlayerExpanded(true);
    setMainWindowVisible(true);
    updatePowerBlocker("playing");
    updatePowerBlocker(state);
    expect(mocks.active.size).toBe(0);
    expect(mocks.stop.mock.calls.map(([id]) => id)).toEqual([0, 1]);
  });

  it("重复状态和配置刷新不会重复申请唤醒锁", () => {
    mocks.enabled = true;
    setPlayerExpanded(true);
    setMainWindowVisible(true);
    updatePowerBlocker("playing");
    updatePowerBlocker("playing");
    setPlayerExpanded(true);
    setMainWindowVisible(true);
    refreshPowerBlocker();
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it("退出清理同时重置可见性和播放页状态", () => {
    mocks.enabled = true;
    setPlayerExpanded(true);
    setMainWindowVisible(true);
    updatePowerBlocker("playing");
    releasePowerBlocker();
    expect(mocks.active.size).toBe(0);
    refreshPowerBlocker();
    expect(mocks.active.size).toBe(0);
    updatePowerBlocker("playing");
    expect([...mocks.active.values()]).toEqual(["prevent-app-suspension"]);
  });
});
