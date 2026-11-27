import { mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import SInput from "./SInput.vue";

it("选词时回车与 Escape 留给输入法处理，结束组合后回车仍提交草稿", async () => {
  const wrapper = mount(SInput, { attachTo: document.body, props: { updateOn: "blur" } });
  const shortcut = vi.fn();
  window.addEventListener("keydown", shortcut);
  try {
    const input = wrapper.get("input");
    input.element.focus();
    await input.setValue("歌词");
    for (const key of ["Enter", "Escape"]) {
      const composing = new KeyboardEvent("keydown", {
        key,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      input.element.dispatchEvent(composing);
      expect(composing.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input.element);
      expect(shortcut).not.toHaveBeenCalled();
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    }
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["歌词"]);
  } finally {
    window.removeEventListener("keydown", shortcut);
    wrapper.unmount();
  }
});
