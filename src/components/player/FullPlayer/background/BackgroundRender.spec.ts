import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import BackgroundRender from "./BackgroundRender.vue";

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  renderer: {
    setAlbum: vi.fn().mockResolvedValue(undefined),
    setFPS: vi.fn(),
    setRenderScale: vi.fn(),
    setHasLyric: vi.fn(),
    setStaticMode: vi.fn(),
    setFlowSpeed: vi.fn(),
    setLowFreqVolume: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
    getElement: vi.fn(() => document.createElement("canvas")),
  },
}));

const visibility = ref<DocumentVisibilityState>("visible");
vi.mock("@vueuse/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vueuse/core")>()),
  useDocumentVisibility: () => visibility,
}));
vi.mock("@/services/fftCapture", () => ({
  acquireFft: mocks.acquire,
  releaseFft: mocks.release,
}));
vi.mock("@applemusic-like-lyrics/core", () => ({
  BackgroundRender: { new: () => mocks.renderer },
  MeshGradientRenderer: class {},
  IsolationRenderer: class {},
  PixiRenderer: class {},
}));

afterEach(() => {
  visibility.value = "visible";
  vi.clearAllMocks();
});

describe("背景渲染资源生命周期", () => {
  it("窗口暂停时保留背景画布和专辑纹理，恢复时继续使用原实例", async () => {
    const wrapper = mount(BackgroundRender, {
      props: { album: "cover://album", playing: true, enableBeat: true },
    });
    try {
      const canvas = wrapper.get("canvas").element;
      await wrapper.setProps({ suspended: true });
      expect(mocks.renderer.pause).toHaveBeenCalled();
      expect(mocks.release).toHaveBeenCalledOnce();
      expect(wrapper.get("canvas").element).toBe(canvas);
      expect(mocks.renderer.dispose).not.toHaveBeenCalled();

      visibility.value = "hidden";
      await wrapper.setProps({ suspended: false });
      expect(mocks.acquire).toHaveBeenCalledOnce();
      visibility.value = "visible";
      await nextTick();
      expect(mocks.acquire).toHaveBeenCalledTimes(2);
      expect(wrapper.get("canvas").element).toBe(canvas);
      expect(mocks.renderer.setAlbum).toHaveBeenCalledExactlyOnceWith("cover://album", false);
      expect(mocks.renderer.dispose).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
    expect(mocks.renderer.dispose).toHaveBeenCalledOnce();
  });

  it("隐藏时停止绘制和 FFT，恢复可见后重新获取，卸载时配对释放", async () => {
    const wrapper = mount(BackgroundRender, { props: { playing: true, enableBeat: true } });
    try {
      expect(mocks.acquire).toHaveBeenCalledTimes(1);
      visibility.value = "hidden";
      await nextTick();
      expect(mocks.renderer.pause).toHaveBeenCalledOnce();
      expect(mocks.release).toHaveBeenCalledTimes(1);
      visibility.value = "visible";
      await nextTick();
      expect(mocks.acquire).toHaveBeenCalledTimes(2);
      expect(mocks.renderer.resume).toHaveBeenCalledTimes(2);
    } finally {
      wrapper.unmount();
    }
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
