/* eslint-disable vue/one-component-per-file -- 界面测试需要多个控件桩 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref, type PropType } from "vue";

let state: Record<string, unknown>;
const install = vi.fn(),
  uninstall = vi.fn(),
  cancelInstall = vi.fn();
vi.mock("@/composables/useLocalLyricAlignment", () => ({ useLocalLyricAlignment: () => state }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => ({ lyric: {} }) }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import LocalLyricAlignmentDialog from "./LocalLyricAlignmentDialog.vue";

beforeEach(() => {
  install.mockClear();
  uninstall.mockClear();
  cancelInstall.mockClear();
  state = {
    translation: ref(true),
    romanization: ref(true),
    realignExisting: ref(false),
    busy: ref(false),
    completed: ref(false),
    error: ref(""),
    translationError: ref(""),
    source: ref({ lines: [], error: "" }),
    fields: ref(["translation", "romanization"]),
    coverage: ref([]),
    rows: ref([
      {
        id: 0,
        text: "君と夢",
        words: ["君", "と", "夢"],
        translation: "与你的梦",
        romanization: "kimi to yume",
        original: { translation: "与你的梦", romanization: "kimi to yume" },
        result: {
          translation: {
            parts: [
              { text: "与你", from: 0, to: 1 },
              { text: "的梦", from: 2, to: 2 },
            ],
          },
        },
      },
    ]),
    results: ref([]),
    selected: ref(new Set()),
    canStart: ref(false),
    canApply: ref(false),
    start: vi.fn(),
    cancel: vi.fn(),
    select: vi.fn(),
    apply: vi.fn(),
    environment: {
      status: ref({
        installed: false,
        hasFiles: false,
        supported: true,
        inUse: false,
        phase: "not-installed",
        error: "",
      }),
      loading: ref(false),
      error: ref(""),
      busy: ref(false),
      installing: ref(false),
      canInstall: ref(true),
      canUninstall: ref(false),
      progress: ref(null),
      install,
      uninstall,
      cancelInstall,
    },
  };
});

/** 用原生控件保留真实点击和标题属性，避免 UI 桩掩盖悬浮提示 */
const render = () =>
  mount(LocalLyricAlignmentDialog, {
    props: { open: true },
    global: {
      stubs: {
        SDialog: defineComponent({
          props: { title: String, open: Boolean, width: String },
          setup(props, { slots }) {
            return () =>
              h("section", [
                h("h1", props.title),
                slots.default?.(),
                slots.footer?.({ close: vi.fn() }),
              ]);
          },
        }),
        SButton: defineComponent({
          props: { disabled: Boolean, variant: String, size: String, type: String },
          setup(props, { slots }) {
            return () => h("button", { disabled: props.disabled }, slots.default?.());
          },
        }),
        SCheckbox: defineComponent({
          props: { label: String, checked: Boolean, disabled: Boolean },
          setup(props) {
            return () => h("label", props.label);
          },
        }),
        SVirtualList: defineComponent({
          props: {
            items: { type: Array as PropType<unknown[]>, default: () => [] },
            itemHeight: Number,
            getItemKey: Function,
            height: String,
          },
          setup(props, { slots }) {
            return () =>
              h(
                "div",
                props.items.map((item: unknown) => slots.default?.({ item })),
              );
          },
        }),
        SLoading: true,
      },
    },
  });

describe("算法对齐环境界面", () => {
  it("开始前不提供行勾选，完成后只有候选结果可勾选，不显示混合失败原因", async () => {
    const wrapper = render();
    expect(wrapper.find('[data-alignment-line="0"]').findAll("label")).toHaveLength(0);
    (state.completed as { value: boolean }).value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-alignment-line="0"]').findAll("label")).toHaveLength(1);
    expect(wrapper.text()).toContain("localAlignment.matched");
    expect(wrapper.text()).toContain("localAlignment.uncertain");
    (state.fields as { value: string[] }).value = ["translation"];
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain("localAlignment.uncertain");
    wrapper.unmount();
  });
  it("提供手动安装入口，打开弹窗不安装且不再出现路径、命令和悬浮标题", async () => {
    const wrapper = render();
    expect(install).not.toHaveBeenCalled();
    expect(wrapper.findAll("[title]")).toHaveLength(0);
    expect(wrapper.findAll("input")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("pip install");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("installEnvironment"))!
      .trigger("click");
    expect(install).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it("已安装时显示卸载入口，取消安装按钮只在安装期间出现", async () => {
    const env = state.environment as {
      status: { value: Record<string, unknown> };
      canUninstall: { value: boolean };
      installing: { value: boolean };
    };
    env.status.value = { ...env.status.value, phase: "ready", installed: true, hasFiles: true };
    env.canUninstall.value = true;
    const wrapper = render();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("uninstallEnvironment"))!
      .trigger("click");
    expect(uninstall).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain("cancelInstall");
    env.status.value = { ...env.status.value, phase: "downloading-python", installed: false };
    env.installing.value = true;
    await wrapper.vm.$nextTick();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("cancelInstall"))!
      .trigger("click");
    expect(cancelInstall).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
