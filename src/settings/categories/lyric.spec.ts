import { describe, expect, it, vi } from "vitest";
import zh from "@/i18n/locales/zh-CN.json";
import en from "@/i18n/locales/en-US.json";
const state = vi.hoisted(() => ({ lyric: { engine: "physics", showTranslation: true } }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => state }));
import category from "./lyric";

describe("翻译显示设置", () => {
  it("与翻译总开关相邻，双引擎可用，总显隐关闭时禁用逐字高亮设置", () => {
    const items = category.sections!.flatMap((section) => section.items);
    const translation = items.findIndex((item) => item.key === "showTranslation");
    const aligned = items[translation + 1];
    expect(aligned.key).toBe("showWordTranslation");
    expect(aligned.binding).toEqual({ store: "settings", path: "lyric.showWordTranslation" });
    expect(aligned.defaultValue).toBe(true);
    expect(aligned.visible).toBeUndefined();
    expect(typeof aligned.disabled === "function" && aligned.disabled()).toBe(false);
    state.lyric.showTranslation = false;
    expect(typeof aligned.disabled === "function" && aligned.disabled()).toBe(true);
    state.lyric.showTranslation = true;
    expect(zh.settings.showWordTranslation.label).toBeTruthy();
    expect(en.settings.showWordTranslation.description).toBeTruthy();
  });
});
