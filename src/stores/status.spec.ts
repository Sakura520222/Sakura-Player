import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import persistedState from "pinia-plugin-persistedstate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStatusStore } from "./status";

vi.mock("./queue", () => ({ getTrack: vi.fn(), getQueueItem: vi.fn() }));

/**
 * 创建启用真实持久化插件的独立状态仓库
 * @returns 当前测试的状态仓库
 */
const setupStore = () => {
  const pinia = createPinia().use(persistedState);
  createApp({}).use(pinia);
  setActivePinia(pinia);
  return useStatusStore();
};

describe("歌曲列表排序偏好", () => {
  beforeEach(() => localStorage.clear());

  it("资料库、本地喜欢和在线喜欢的排序互不影响", () => {
    const status = setupStore();
    status.setSortPreference("library", { field: "title", order: "desc" });
    status.setSortPreference("liked.local", { field: "artist", order: "asc" });

    expect(status.getSortPreference("library")).toEqual({ field: "title", order: "desc" });
    expect(status.getSortPreference("liked.local")).toEqual({ field: "artist", order: "asc" });
    expect(status.getSortPreference("liked.online")).toEqual({ field: "none", order: "asc" });
    expect(status.getSortPreference("collection.playlist")).toEqual({
      field: "none",
      order: "asc",
    });
  });

  it("重新创建仓库后恢复各页面的独立排序", async () => {
    const status = setupStore();
    status.setSortPreference("library", { field: "title", order: "desc" });
    status.setSortPreference("history", { field: "duration", order: "asc" });
    await nextTick();

    const restored = setupStore();
    expect(restored.getSortPreference("library")).toEqual({ field: "title", order: "desc" });
    expect(restored.getSortPreference("history")).toEqual({ field: "duration", order: "asc" });
  });

  it("重置单个页面排序只移除该页面的持久化偏好", async () => {
    const status = setupStore();
    status.setSortPreference("library", { field: "title", order: "desc" });
    status.setSortPreference("liked.local", { field: "artist", order: "asc" });
    status.setSortPreference("library", { field: "none", order: "asc" });
    await nextTick();

    const saved = JSON.parse(localStorage.getItem("status")!);
    expect(saved.sortPreferences).toEqual({ "liked.local": { field: "artist", order: "asc" } });
    expect(saved).not.toHaveProperty("sortField");
    expect(saved).not.toHaveProperty("sortOrder");
  });
});
