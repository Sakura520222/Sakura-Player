import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import type { AlignmentEnvironmentState, LyricAlignmentApi } from "@shared/types/lyricAlignment";
import { useLyricAlignmentEnvironment } from "./useLyricAlignmentEnvironment";

const absent: AlignmentEnvironmentState = {
  revision: 1,
  phase: "not-installed",
  installed: false,
  hasFiles: false,
  supported: true,
  inUse: false,
  downloadedBytes: 0,
  totalBytes: 0,
  detail: "",
  error: "",
};
const ready: AlignmentEnvironmentState = {
  ...absent,
  revision: 3,
  phase: "ready",
  installed: true,
  hasFiles: true,
};
const api = {
  environmentStatus: vi.fn<LyricAlignmentApi["environmentStatus"]>(),
  installEnvironment: vi.fn<LyricAlignmentApi["installEnvironment"]>(),
  uninstallEnvironment: vi.fn<LyricAlignmentApi["uninstallEnvironment"]>(),
  cancelEnvironmentInstall: vi.fn<LyricAlignmentApi["cancelEnvironmentInstall"]>(),
  onEnvironmentStatus: vi.fn<LyricAlignmentApi["onEnvironmentStatus"]>(),
};
const unsubscribe = vi.fn();
let push!: (state: AlignmentEnvironmentState) => void;
const wrappers: ReturnType<typeof mount>[] = [];

/** 挂载真实生命周期并等待初始只读查询 */
const setup = async () => {
  const open = ref(true);
  let environment!: ReturnType<typeof useLyricAlignmentEnvironment>;
  const wrapper = mount(
    defineComponent({
      setup() {
        environment = useLyricAlignmentEnvironment(open);
        return () => null;
      },
    }),
  );
  wrappers.push(wrapper);
  await flushPromises();
  return { ...environment, open, wrapper };
};

beforeEach(() => {
  api.environmentStatus.mockReset().mockResolvedValue(absent);
  api.installEnvironment.mockReset().mockResolvedValue(ready);
  api.uninstallEnvironment.mockReset().mockResolvedValue({ ...absent, revision: 5 });
  api.cancelEnvironmentInstall.mockReset().mockResolvedValue(true);
  api.onEnvironmentStatus.mockReset().mockImplementation((callback) => {
    push = callback;
    return unsubscribe;
  });
  unsubscribe.mockClear();
  Object.defineProperty(window, "api", { configurable: true, value: { lyricAlignment: api } });
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe("应用内对齐环境操作", () => {
  it("打开只查状态，必须显式调用安装；安装完成可卸载", async () => {
    const state = await setup();
    expect(api.installEnvironment).not.toHaveBeenCalled();
    expect(state.ready.value).toBe(false);
    await state.install();
    expect(state.ready.value).toBe(true);
    expect(state.canUninstall.value).toBe(true);
    await state.uninstall();
    expect(state.status.value.hasFiles).toBe(false);
    expect(state.canInstall.value).toBe(true);
  });
  it("重复点击只发送一次安装，关闭弹窗不取消安装，卸载监听器", async () => {
    let finish!: (state: AlignmentEnvironmentState) => void;
    api.installEnvironment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const state = await setup();
    const pending = state.install();
    await state.install();
    expect(api.installEnvironment).toHaveBeenCalledTimes(1);
    state.wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(api.cancelEnvironmentInstall).not.toHaveBeenCalled();
    finish(ready);
    await pending;
  });
  it("推送优先于迟到的查询并按使用状态阻止卸载", async () => {
    const state = await setup();
    push({ ...ready, inUse: true });
    expect(state.canUninstall.value).toBe(false);
    await state.uninstall();
    expect(api.uninstallEnvironment).not.toHaveBeenCalled();
    push(absent);
    expect(state.status.value.installed).toBe(true);
    push({ ...ready, revision: 4 });
    expect(state.canUninstall.value).toBe(true);
  });
  it("用户可取消下载，失败后提供重试和残留清理", async () => {
    const state = await setup();
    push({
      ...absent,
      revision: 2,
      phase: "downloading-model",
      hasFiles: true,
      downloadedBytes: 25,
      totalBytes: 100,
    });
    expect(state.progress.value).toBe(25);
    await state.cancelInstall();
    expect(api.cancelEnvironmentInstall).toHaveBeenCalledTimes(1);
    push({ ...absent, revision: 3, phase: "error", hasFiles: true, error: "下载校验失败" });
    expect(state.canInstall.value).toBe(true);
    expect(state.canUninstall.value).toBe(true);
  });
});
