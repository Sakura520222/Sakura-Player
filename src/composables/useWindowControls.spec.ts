import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
const mocks = vi.hoisted(() => ({
  background: vi.fn(),
  quit: vi.fn(),
  hide: vi.fn(),
  confirm: vi.fn(),
}));
const settings = {
  system: { system: { borderlessWindow: true } },
  appearance: { rememberCloseChoice: true, closeAction: "quit" },
};
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => settings }));
vi.mock("@/composables/useDialog", () => ({ dialog: { confirm: mocks.confirm } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { useWindowControls } from "./useWindowControls";
let wrapper: ReturnType<typeof mount>;
let controls: ReturnType<typeof useWindowControls>;
beforeEach(() => {
  mocks.background.mockReset().mockResolvedValue(false);
  mocks.quit.mockClear();
  mocks.hide.mockClear();
  mocks.confirm.mockClear();
  settings.appearance.closeAction = "quit";
  settings.appearance.rememberCloseChoice = true;
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      lyricAlignment: { continueInBackground: mocks.background },
      window: {
        quit: mocks.quit,
        hide: mocks.hide,
        isMaximized: async () => false,
        isFullscreen: async () => false,
        onMaximizeChange: () => () => {},
        onFullscreenChange: () => () => {},
      },
    },
  });
  wrapper = mount(
    defineComponent({
      setup() {
        controls = useWindowControls();
        return () => null;
      },
    }),
  );
});
afterEach(() => wrapper.unmount());

describe("关闭窗口时保留后台环境安装", () => {
  it("记忆为退出时仍在安装期间关闭到后台，且不改写用户偏好", async () => {
    mocks.background.mockResolvedValue(true);
    await controls.close();
    expect(mocks.quit).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(settings.appearance.closeAction).toBe("quit");
  });
  it("安装结束后恢复原有关闭选择，明确退出始终有效", async () => {
    await controls.close();
    expect(mocks.quit).toHaveBeenCalledTimes(1);
    mocks.background.mockResolvedValue(true);
    controls.quit();
    expect(mocks.quit).toHaveBeenCalledTimes(2);
    expect(mocks.background).toHaveBeenCalledTimes(1);
  });
});
