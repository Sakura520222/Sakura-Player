import { defineComponent, h, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import type { CompanionMessage, CompanionState, CompanionSurface } from "@shared/types/companion";
import App from "./App.vue";

const popover = defineComponent({
  props: { open: Boolean },
  setup:
    (props, { slots }) =>
    () =>
      h("section", [slots.trigger?.(), props.open ? slots.default?.() : null]),
});

/**
 * 挂载收起的角色，模拟原生窗口根据内容切换视口和主进程推送会话
 * @returns 渲染结果、可更新的配置及回复发布入口
 */
async function mountCompanion(options?: { fixedFrame?: boolean }) {
  const chat = { width: 356, height: 480, avatarX: 276, avatarY: 400, side: "top", align: "end" };
  const bubble = {
    width: 280,
    height: 184,
    avatarX: 100,
    avatarY: 104,
    side: "top",
    align: "center",
  };
  const frame = options?.fixedFrame
    ? { width: 384, height: 480, avatarX: 276, avatarY: 400 }
    : undefined;
  const saved: CompanionState = {
    messages: [{ id: "history", role: "assistant", text: "上次的回复", proactive: true }],
    pending: false,
    draft: "",
    error: null,
    track: null,
    locale: "zh-CN",
    replyBubble: true,
    replyBubbleSeconds: 3,
  };
  let publish!: (state: CompanionState) => void;
  let pushLayout: ((layout: unknown) => void) | undefined;
  let revision = 0;
  const unsubscribe = () => () => {};
  const resize = (width: number, height: number) => {
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("innerHeight", height);
    window.dispatchEvent(new Event("resize"));
  };
  resize(frame ? frame.width : 80, frame ? frame.height : 80);
  const api = {
    getState: async () => structuredClone(saved),
    getLayout: async () => ({ ...chat, bubble, ...(frame ? { frame } : {}) }),
    setExpanded: vi.fn((open: boolean, surface: CompanionSurface) => {
      if (open && !frame) {
        const target = surface === "chat" ? chat : bubble;
        resize(target.width, target.height);
      }
      return ++revision;
    }),
    finishCollapse: vi.fn(() => {
      if (!frame) resize(80, 80);
    }),
    onState: (cb: typeof publish) => {
      publish = cb;
      return () => {};
    },
    onLayout: (cb: (layout: unknown) => void) => {
      pushLayout = cb;
      return () => {};
    },
    onDraft: unsubscribe,
    onBeat: unsubscribe,
    setTyping: vi.fn(),
    setIgnoreMouse: vi.fn(),
  };
  vi.stubGlobal("api", { companion: api, player: { setFftEnabled: vi.fn() } });
  const wrapper = mount(App, {
    attachTo: document.body,
    global: {
      stubs: {
        SPopover: popover,
        SButton: true,
        SInput: defineComponent({
          setup(_, { expose }) {
            expose({ focus: vi.fn() });
            return () => h("input");
          },
        }),
        IconLucideChevronDown: true,
        IconLucideArrowUp: true,
        "icon-lucide-disc-3": true,
      },
    },
  });
  await flushPromises();
  const sync = () => publish(structuredClone(saved));
  const answer = (id: string) => {
    const message: CompanionMessage = { id, role: "assistant", text: id, proactive: true };
    saved.messages.push(message);
    sync();
  };
  return { wrapper, saved, sync, answer, api, pushLayout: (l: unknown) => pushLayout?.(l) };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("忽略历史快照，替换新回复并重新计时，重复快照不延长气泡", async () => {
  const { wrapper, answer, sync, api } = await mountCompanion();
  try {
    vi.useFakeTimers();
    expect(wrapper.find(".reply-preview").exists()).toBe(false);
    answer("第一条");
    await nextTick();
    await vi.advanceTimersByTimeAsync(2000);
    answer("第二条");
    await nextTick();
    await vi.advanceTimersByTimeAsync(2000);
    sync();
    await nextTick();
    expect(wrapper.get(".reply-preview").text()).toBe("第二条");
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.find(".reply-preview").exists()).toBe(false);
    expect(wrapper.find(".unread").exists()).toBe(true);
    expect(api.finishCollapse).toHaveBeenCalledOnce();
  } finally {
    wrapper.unmount();
  }
});

it("阅读时暂停计时，关闭配置立即隐藏，再开启不会重播旧消息", async () => {
  const { wrapper, answer, saved, sync } = await mountCompanion();
  try {
    vi.useFakeTimers();
    answer("等我读完");
    await nextTick();
    await wrapper.get(".reply-preview").trigger("pointerenter");
    await vi.advanceTimersByTimeAsync(4000);
    expect(wrapper.get(".reply-preview").text()).toBe("等我读完");
    await wrapper.get(".reply-preview").trigger("pointerleave");
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.find(".reply-preview").exists()).toBe(false);
    answer("隐藏我");
    await nextTick();
    saved.replyBubble = false;
    sync();
    await nextTick();
    expect(wrapper.find(".reply-preview").exists()).toBe(false);
    answer("仅未读提示");
    saved.replyBubble = true;
    sync();
    await nextTick();
    expect(wrapper.find(".reply-preview").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

it("键盘阅读可以暂停计时并通过 Shift+Tab 回到角色", async () => {
  const { wrapper, answer } = await mountCompanion();
  try {
    vi.useFakeTimers();
    answer("用键盘读这条回复");
    await nextTick();
    const preview = wrapper.get<HTMLButtonElement>(".reply-preview");
    preview.element.focus();
    await nextTick();
    await vi.advanceTimersByTimeAsync(4000);
    expect(document.activeElement).toBe(preview.element);
    await preview.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(wrapper.get(".avatar").element);
    await vi.advanceTimersByTimeAsync(3000);
    expect(wrapper.find(".reply-preview").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

it("切换到气泡尺寸后重新同步透明留白的鼠标穿透", async () => {
  const { wrapper, answer, api } = await mountCompanion();
  try {
    await wrapper.get("main").trigger("pointermove");
    expect(api.setIgnoreMouse).toHaveBeenCalledExactlyOnceWith(true);
    answer("切换到气泡");
    await nextTick();
    await wrapper.get("main").trigger("pointermove");
    expect(api.setIgnoreMouse).toHaveBeenCalledTimes(2);
    expect(api.setIgnoreMouse).toHaveBeenLastCalledWith(true);
  } finally {
    wrapper.unmount();
  }
});

it("固定外框模式下无需调整视口即可展开气泡与聊天，角色锚点保持不变", async () => {
  const { wrapper, answer, api } = await mountCompanion({ fixedFrame: true });
  try {
    const main = wrapper.get("main").element as HTMLElement;
    expect(main.style.getPropertyValue("--avatar-x")).toBe("276px");
    expect(main.style.getPropertyValue("--avatar-y")).toBe("400px");
    answer("不缩窗直接弹出");
    await nextTick();
    expect(wrapper.get(".reply-preview").text()).toBe("不缩窗直接弹出");
    expect(main.style.getPropertyValue("--avatar-x")).toBe("276px");
    expect(main.style.getPropertyValue("--avatar-y")).toBe("400px");
    await wrapper.get(".reply-preview").trigger("click");
    await nextTick();
    expect(wrapper.find(".composer").exists()).toBe(true);
    expect(main.style.getPropertyValue("--avatar-x")).toBe("276px");
    expect(main.style.getPropertyValue("--avatar-y")).toBe("400px");
    await wrapper.get(".avatar").trigger("click");
    await nextTick();
    expect(wrapper.find(".composer").exists()).toBe(false);
    expect(api.finishCollapse).toHaveBeenCalledOnce();
    expect(main.style.getPropertyValue("--avatar-x")).toBe("276px");
    expect(main.style.getPropertyValue("--avatar-y")).toBe("400px");
  } finally {
    wrapper.unmount();
  }
});

it("固定外框在选区松手与失焦后恢复点击穿透，不吞噬透明区域点击", async () => {
  const { wrapper, api, pushLayout } = await mountCompanion({ fixedFrame: true });
  try {
    const avatarEl = wrapper.get(".avatar").element;
    const mainEl = wrapper.get("main").element;
    document.elementFromPoint = vi.fn(() => mainEl);
    await wrapper.get(".avatar").trigger("pointermove", { clientX: 300, clientY: 420, buttons: 0 });
    expect(api.setIgnoreMouse).toHaveBeenLastCalledWith(false);
    // 按住鼠标拖出到透明区后松手
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 10, buttons: 1 }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(api.setIgnoreMouse).toHaveBeenLastCalledWith(true);
    // 移回角色再触发窗口失焦或布局翻转时也恢复穿透
    await wrapper.get(".avatar").trigger("pointermove", { clientX: 300, clientY: 420, buttons: 0 });
    expect(api.setIgnoreMouse).toHaveBeenLastCalledWith(false);
    window.dispatchEvent(new Event("blur"));
    expect(api.setIgnoreMouse).toHaveBeenLastCalledWith(true);
    document.elementFromPoint = vi.fn(() => avatarEl);
    await wrapper.get(".avatar").trigger("pointermove", { clientX: 300, clientY: 420, buttons: 0 });
    expect(api.setIgnoreMouse).toHaveBeenLastCalledWith(false);
    pushLayout({
      width: 356,
      height: 480,
      avatarX: 0,
      avatarY: 0,
      side: "bottom",
      align: "start",
      bubble: { width: 280, height: 184, avatarX: 0, avatarY: 0, side: "bottom", align: "start" },
      frame: { width: 356, height: 480, avatarX: 0, avatarY: 0 },
    });
    expect(api.setIgnoreMouse).toHaveBeenLastCalledWith(true);
  } finally {
    wrapper.unmount();
  }
});
