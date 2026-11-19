import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ErrorCode } from "@shared/types/errors";

const mocks = vi.hoisted(() => ({
  addScanDir: vi.fn(),
  removeScanDir: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("localforage", () => ({
  default: { createInstance: () => ({ getItem: mocks.getItem, setItem: mocks.setItem }) },
}));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  Object.assign(window, {
    api: {
      library: {
        addScanDir: mocks.addScanDir,
        removeScanDir: mocks.removeScanDir,
        getTracks: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getScanDirs: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getArtists: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
    },
  });
});

describe("本地歌曲收藏", () => {
  it("冷启动单独恢复收藏，之后加载曲库时保留已更新的状态", async () => {
    mocks.getItem.mockImplementation((key) =>
      Promise.resolve(key === "liked-ids" ? ["restored", "older"] : null),
    );
    mocks.setItem.mockResolvedValue(undefined);
    const { useLibraryStore } = await import("./library");
    const store = useLibraryStore();

    await Promise.all([store.loadLiked(), store.loadLiked()]);
    expect(mocks.getItem).toHaveBeenCalledExactlyOnceWith("liked-ids");
    expect(window.api.library.getTracks).not.toHaveBeenCalled();
    expect(store.likedOrderedIds).toEqual(["restored", "older"]);
    expect(store.isLiked("restored")).toBe(true);
    expect(store.isLiked("other")).toBe(false);

    expect(store.toggleLike("restored")).toBe(false);
    await store.load();
    expect(store.isLiked("restored")).toBe(false);
    expect(store.likedOrderedIds).toEqual(["older"]);
    expect(mocks.getItem.mock.calls).toEqual([["liked-ids"], ["tracks"]]);
  });
});

describe("曲库扫描目录", () => {
  it("添加成功时同步到本地列表且不触发移除", async () => {
    mocks.addScanDir.mockResolvedValue({ success: true, data: "C:/music" });
    const { useLibraryStore } = await import("./library");
    const store = useLibraryStore();
    const res = await store.addScanDir();
    expect(res.success).toBe(true);
    expect(store.scanDirs).toContain("C:/music");
    expect(mocks.removeScanDir).not.toHaveBeenCalled();
  });

  it("嵌套目录被主进程拒绝时列表不变且不调用移除", async () => {
    mocks.addScanDir.mockResolvedValue({
      success: false,
      error: ErrorCode.SCAN_DIR_NESTED,
    });
    const { useLibraryStore } = await import("./library");
    const store = useLibraryStore();
    store.scanDirs = ["C:/music"];
    const res = await store.addScanDir();
    expect(res.success).toBe(false);
    expect(res.error).toBe(ErrorCode.SCAN_DIR_NESTED);
    expect(store.scanDirs).toEqual(["C:/music"]);
    expect(mocks.removeScanDir).not.toHaveBeenCalled();
  });
});
