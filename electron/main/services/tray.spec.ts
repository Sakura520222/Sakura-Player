import type { MenuItemConstructorOptions } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  templates: [] as MenuItemConstructorOptions[][],
  setContextMenu: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
  toggleDesktopPet: vi.fn(),
  loadThemedIcon: vi.fn((_dir: string, name: string) => ({ iconName: name })),
}));

vi.mock("electron", () => {
  class MockTray {
    setContextMenu = mocks.setContextMenu;
    destroy = mocks.destroy;
    on = mocks.on;
  }
  return {
    app: { quit: vi.fn() },
    Menu: {
      buildFromTemplate: vi.fn((items: MenuItemConstructorOptions[]) => {
        mocks.templates.push(items);
        return { items };
      }),
    },
    Tray: MockTray,
    nativeTheme: { on: vi.fn() },
  };
});
vi.mock("@main/utils/broadcast", () => ({ sendToMain: vi.fn() }));
vi.mock("@main/utils/config", () => ({ appName: "Sakura Player", isWin: true }));
vi.mock("@main/utils/icon", () => ({
  loadIcon: vi.fn(() => ({ setTemplateImage: vi.fn() })),
  loadThemedIcon: mocks.loadThemedIcon,
}));
vi.mock("@main/utils/logger", () => ({ trayLog: { info: vi.fn() } }));
vi.mock("@main/window", () => ({
  toggleDesktopLyricWindow: vi.fn(),
  toggleDynamicIslandWindow: vi.fn(),
  toggleTaskbarLyricWindow: vi.fn(),
  focusMainWindow: vi.fn(),
}));
vi.mock("@main/services/companion", () => ({
  toggleDesktopPet: mocks.toggleDesktopPet,
}));

import { setLocale } from "@main/utils/i18n";
import { destroyTray, initTray, refreshTray, setTrayDesktopPet } from "./tray";

describe("托盘菜单桌面宠物开关", () => {
  beforeEach(() => {
    mocks.templates.length = 0;
    mocks.setContextMenu.mockClear();
    mocks.toggleDesktopPet.mockClear();
    mocks.loadThemedIcon.mockClear();
    setLocale("zh-CN");
    setTrayDesktopPet(false);
    initTray();
  });

  afterEach(() => {
    setTrayDesktopPet(false);
    destroyTray();
    setLocale("zh-CN");
  });

  it("在任务栏歌词下方提供桌面宠物开关并同步文案与点击事件", () => {
    const initial = mocks.templates.at(-1)!;
    const taskbarIndex = initial.findIndex((item) => item.label === "开启任务栏歌词");
    const petItem = initial[taskbarIndex + 1];
    expect(petItem?.label).toBe("开启桌面宠物");
    expect(petItem?.icon).toEqual({ iconName: "companion" });
    expect(initial[taskbarIndex + 2]?.type).toBe("separator");

    petItem?.click?.({} as never, undefined, {} as never);
    expect(mocks.toggleDesktopPet).toHaveBeenCalledOnce();

    setTrayDesktopPet(true);
    const opened = mocks.templates.at(-1)!;
    expect(opened[taskbarIndex + 1]?.label).toBe("关闭桌面宠物");

    setLocale("en-US");
    refreshTray();
    expect(mocks.templates.at(-1)![taskbarIndex + 1]?.label).toBe("Close Desktop Pet");
    setTrayDesktopPet(false);
    expect(mocks.templates.at(-1)![taskbarIndex + 1]?.label).toBe("Open Desktop Pet");
  });
});
