import { mount } from "@vue/test-utils";
import { defineComponent, ref, nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/stores/media", () => ({
  useMediaStore: () => ({ track: { id: "song" }, parsedLyric: [{}], lyricLoading: false }),
}));
vi.mock("@/stores/status", () => ({ useStatusStore: () => ({ lyricOffsetMs: 0 }) }));
vi.mock("@/settings/useSettingsDialog", () => ({ useSettingsDialog: () => ({ show: vi.fn() }) }));
vi.mock("../context", () => ({ useFullPlayer: () => ({ immersive: ref(false) }) }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import LyricActions from "./LyricActions.vue";

describe("歌词操作弹窗关闭生命周期", () => {
  it.each([
    ["AiLyricTranslationDialog", "player.aiTranslation.title"],
    ["LocalLyricAlignmentDialog", "player.localAlignment.title"],
  ])("%s 关闭后保留到退出动画结束，快速重开不被旧回调卸载", async (name, label) => {
    const modal = defineComponent({
      name,
      props: { open: Boolean },
      emits: ["update:open", "after-close"],
      template: "<div />",
    });
    const wrapper = mount(LyricActions, {
      global: {
        stubs: {
          SButton: { template: "<button><slot /></button>" },
          SPopover: true,
          SNumberInput: true,
          CopyLyricsDialog: true,
          LyricMatchDialog: true,
          AiLyricTranslationDialog: name === "AiLyricTranslationDialog" ? modal : true,
          LocalLyricAlignmentDialog: name === "LocalLyricAlignmentDialog" ? modal : true,
        },
      },
    });
    try {
      expect(wrapper.findComponent({ name }).exists()).toBe(false);
      const trigger = wrapper.get(`[aria-label="${label}"]`);
      await trigger.trigger("click");
      const dialog = wrapper.getComponent({ name });
      dialog.vm.$emit("update:open", false);
      await nextTick();
      expect(wrapper.getComponent({ name }).props("open")).toBe(false);
      await trigger.trigger("click");
      dialog.vm.$emit("after-close");
      await nextTick();
      expect(wrapper.getComponent({ name }).props("open")).toBe(true);
      dialog.vm.$emit("update:open", false);
      await nextTick();
      dialog.vm.$emit("after-close");
      await nextTick();
      expect(wrapper.findComponent({ name }).exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
