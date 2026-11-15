import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import AlbumCase from "./AlbumCase.vue";
import { FRONT_POSE } from "./albumCaseMath";

const mocks = vi.hoisted(() => ({
  draw: vi.fn(),
  setCover: vi.fn(async () => {}),
  setNotes: vi.fn(),
  dispose: vi.fn(),
  create: vi.fn(),
}));
vi.mock("./albumCaseScene", () => ({ createAlbumCaseScene: mocks.create }));
let now = 0;
let nextId = 0;
const frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  now = 0;
  frames.clear();
  vi.clearAllMocks();
  mocks.create.mockResolvedValue(mocks);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});
afterEach(() => vi.restoreAllMocks());

/**
 * 推进真实动画逻辑，逐帧执行合并后的绘制请求
 * @param milliseconds - 推进时长
 */
const advance = async (milliseconds: number): Promise<void> => {
  const end = now + milliseconds;
  while (now < end) {
    now = Math.min(end, now + 16);
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  }
  await nextTick();
};

/**
 * 挂载真实交互组件，绘图后端使用可观察的资源对象
 * @returns 组件包装器
 */
const mountCase = async () => {
  const wrapper = mount(AlbumCase, {
    props: { title: "Amazing Sky", listening: null, active: true },
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", missingWarn: false })],
      stubs: { DetailCover: true },
    },
  });
  Object.assign(wrapper.element, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  await flushPromises();
  await advance(16);
  return wrapper;
};

describe("专辑盒交互与资源生命周期", () => {
  it("垂直拖拽与松手惯性使用一致的屏幕方向", async () => {
    const wrapper = await mountCase();
    await wrapper.trigger("pointerdown", { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    now += 16;
    await wrapper.trigger("pointermove", { pointerId: 1, clientX: 0, clientY: 20 });
    await advance(16);
    const draggedPitch = mocks.draw.mock.lastCall?.[0][0];
    expect(draggedPitch).toBeGreaterThan(0);
    await wrapper.trigger("pointerup", { pointerId: 1, button: 0 });
    await advance(32);
    expect(mocks.draw.mock.lastCall?.[0][0]).toBeGreaterThan(draggedPitch);
    await wrapper.setProps({ reduceMotion: true });
    await wrapper.trigger("keydown", { key: "Home" });
    await wrapper.trigger("keydown", { key: "ArrowUp" });
    await advance(16);
    expect(mocks.draw.mock.lastCall?.[0][0]).toBeLessThan(0);
    wrapper.unmount();
  });
  it("点击开合，拖拽不误触开合，静止或按住不移动时停止绘制", async () => {
    const wrapper = await mountCase();
    await wrapper.trigger("pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    await wrapper.trigger("pointerup", { pointerId: 1, button: 0 });
    await advance(600);
    expect(wrapper.attributes("data-open")).toBe("true");
    expect(mocks.draw).toHaveBeenLastCalledWith(FRONT_POSE, 1, 1);
    expect(frames.size).toBe(0);
    await wrapper.trigger("pointerdown", { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    now += 16;
    await wrapper.trigger("pointermove", { pointerId: 2, clientX: 100, clientY: 30 });
    await advance(32);
    expect(mocks.draw.mock.lastCall?.[0]).not.toEqual(FRONT_POSE);
    expect(frames.size).toBe(0);
    await wrapper.trigger("pointerup", { pointerId: 2, button: 0 });
    expect(wrapper.attributes("data-open")).toBe("true");
    wrapper.unmount();
  });

  it("松手后继续旋转并减速，中键复位取消惯性且回到正面闭盒", async () => {
    const wrapper = await mountCase();
    await wrapper.trigger("pointerdown", { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    now += 16;
    await wrapper.trigger("pointermove", { pointerId: 1, clientX: 20, clientY: 0 });
    await advance(16);
    const releasePose = mocks.draw.mock.lastCall?.[0];
    await wrapper.trigger("pointerup", { pointerId: 1, button: 0 });
    await wrapper.trigger("lostpointercapture", { pointerId: 1 });
    await advance(100);
    expect(mocks.draw.mock.lastCall?.[0]).not.toEqual(releasePose);
    expect(frames.size).toBe(1);
    await advance(5000);
    expect(frames.size).toBe(0);
    await wrapper.trigger("pointerdown", { pointerId: 2, button: 1 });
    await advance(750);
    expect(mocks.draw).toHaveBeenLastCalledWith(FRONT_POSE, 0, 0);
    expect(frames.size).toBe(0);
    wrapper.unmount();
  });

  it("关闭取消活动帧与手势，卸载释放场景", async () => {
    const wrapper = await mountCase();
    await wrapper.trigger("keydown", { key: "Enter" });
    await advance(100);
    await wrapper.trigger("pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    await wrapper.setProps({ active: false });
    expect(frames.size).toBe(0);
    const calls = mocks.draw.mock.calls.length;
    await wrapper.trigger("pointermove", { pointerId: 1, clientX: 100, clientY: 30 });
    await advance(1000);
    expect(mocks.draw).toHaveBeenCalledTimes(calls);
    wrapper.unmount();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("减少动画时立即开合与复位，缺失统计保持未知", async () => {
    const wrapper = await mountCase();
    expect(mocks.setNotes.mock.lastCall?.[0].count).toBe("—");
    await wrapper.setProps({ reduceMotion: true });
    await wrapper.trigger("keydown", { key: "Enter" });
    await advance(16);
    expect(mocks.draw).toHaveBeenLastCalledWith(FRONT_POSE, 1, 1);
    await wrapper.trigger("keydown", { key: "ArrowLeft" });
    await advance(16);
    expect(mocks.draw.mock.lastCall?.[0]).not.toEqual(FRONT_POSE);
    await wrapper.trigger("keydown", { key: "Home" });
    await advance(16);
    expect(mocks.draw).toHaveBeenLastCalledWith(FRONT_POSE, 0, 0);
    wrapper.unmount();
  });

  it("创建场景期间关闭后也会释放迟到的资源", async () => {
    const pending = Promise.withResolvers<typeof mocks>();
    mocks.create.mockReturnValueOnce(pending.promise);
    const wrapper = await mountCase();
    wrapper.unmount();
    pending.resolve(mocks);
    await flushPromises();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });
});
