import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import type { CompanionMessage } from "@shared/types/companion";
import CompanionDanmaku from "./CompanionDanmaku.vue";

/**
 * 挂载全屏弹幕并接入与预加载接口一致的消息发布器
 * @param reducedMotion - 是否按静态单行显示回复
 * @returns 组件、消息发送方法和订阅清理探针
 */
function mountOverlay(reducedMotion = false) {
  const stop = vi.fn();
  let receive!: (message: CompanionMessage) => void;
  vi.stubGlobal("api", {
    companion: {
      onDanmaku: (handler: typeof receive) => {
        receive = handler;
        return stop;
      },
    },
  });
  const wrapper = mount(CompanionDanmaku, {
    attachTo: document.body,
    props: { lanes: 2, seconds: 8, reducedMotion },
  });
  const send = (id: string, text = id, role: CompanionMessage["role"] = "assistant") =>
    receive({ id, text, role, proactive: false });
  return { wrapper, send, stop };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("完整回复占用一条轨道，滚完才重用，满载时跳过新弹幕", async () => {
  const { wrapper, send, stop } = mountOverlay();
  try {
    send("user", "用户输入", "user");
    const reply = "听，这里有回声！\n" + "下一段还在继续。".repeat(30) + "最后一句。";
    send("one", reply);
    send("one", "重复事件");
    send("two");
    send("three");
    await nextTick();
    const items = wrapper.findAll(".remark");
    expect(items.map((item) => item.text())).toEqual([reply, "two"]);
    expect(items.map((item) => (item.element as HTMLElement).style.top)).toEqual([
      "0rem",
      "1.5rem",
    ]);
    expect(items[0].classes()).toContain("scrolling");
    await items[0].trigger("animationend");
    send("four");
    await nextTick();
    expect(wrapper.findAll(".remark").map((item) => item.text())).toEqual(["two", "four"]);
    await wrapper.setProps({ lanes: 1, seconds: 10 });
    expect(wrapper.findAll(".remark").map((item) => item.text())).toEqual(["four"]);
    expect(wrapper.element.style.getPropertyValue("--travel-time")).toBe("10s");
    await wrapper.setProps({ seconds: NaN });
    expect(wrapper.element.style.getPropertyValue("--travel-time")).toBe("9s");
  } finally {
    wrapper.unmount();
  }
  expect(stop).toHaveBeenCalledOnce();
});

it("减少动态效果按实际换行翻页，末行停留结束后清理", async () => {
  vi.useFakeTimers();
  const { wrapper, send } = mountOverlay();
  try {
    send("scrolling");
    await wrapper.setProps({ reducedMotion: true });
    expect(wrapper.find(".remark").exists()).toBe(false);
    send("still", "🌸".repeat(100));
    await nextTick();
    const line = wrapper.get<HTMLElement>(".stationary").element;
    expect(line.textContent).toBe("🌸".repeat(100));
    Object.defineProperties(line, { clientHeight: { value: 24 }, scrollHeight: { value: 72 } });
    line.style.lineHeight = "24px";
    vi.advanceTimersByTime(8000);
    expect(line.scrollTop).toBe(24);
    vi.advanceTimersByTime(8000);
    expect(line.scrollTop).toBe(48);
    vi.advanceTimersByTime(8000);
    await nextTick();
    expect(wrapper.find(".remark").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

it("滚动弹幕使用具体像素 translate3d 启动 Web Animation 并在完成后释放轨道", async () => {
  const finishResolvers: (() => void)[] = [];
  const animateCalls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  const originalAnimate = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = vi.fn(function (
    this: HTMLElement,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    let resolve!: () => void;
    const finished = new Promise<Animation>((done) => {
      resolve = () => done({} as Animation);
    });
    finishResolvers.push(resolve);
    animateCalls.push({
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
    });
    return {
      finished,
      cancel: vi.fn(),
    } as unknown as Animation;
  });
  const { wrapper, send } = mountOverlay();
  try {
    Object.defineProperty(wrapper.element, "clientWidth", { value: 1200, configurable: true });
    send("smooth", "流畅弹幕");
    await nextTick();
    expect(animateCalls).toHaveLength(1);
    expect(animateCalls[0]!.keyframes).toEqual([
      { transform: "translate3d(1200px, 0, 0)" },
      { transform: "translate3d(0px, 0, 0)" },
    ]);
    expect(animateCalls[0]!.options).toMatchObject({
      duration: 8000,
      easing: "linear",
      fill: "forwards",
    });
    finishResolvers[0]!();
    await Promise.resolve();
    await nextTick();
    expect(wrapper.find(".remark").exists()).toBe(false);
  } finally {
    wrapper.unmount();
    HTMLElement.prototype.animate = originalAnimate;
  }
});
