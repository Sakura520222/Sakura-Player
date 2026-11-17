import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref, type PropType } from "vue";

let state: Record<string, unknown>;
const settingsShow = vi.hoisted(() => vi.fn());
vi.mock("@/settings/useSettingsDialog", () => ({
  useSettingsDialog: () => ({ show: settingsShow }),
}));
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
  settingsShow.mockClear();
  state = {
    primary: ref(false),
    language: ref("ja"),
    acousticEnvironment: { ready: ref(false), loading: ref(false) },
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
      ready: ref(false),
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
        SSelect: true,
        STag: true,
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
  it("模型管理跳到设置，对齐弹窗不直接安装或卸载", async () => {
    const wrapper = render();
    expect(install).not.toHaveBeenCalled();
    expect(wrapper.findAll("input")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("pip install");
    expect(wrapper.text()).not.toContain("installEnvironment");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("openModelSettings"))!
      .trigger("click");
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(settingsShow).toHaveBeenCalledWith("lyric", "lyricAlignmentModels");
    expect(install).not.toHaveBeenCalled();
    expect(uninstall).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("模型检查不闪现缺失提示，就绪与缺失状态共用同一行", async () => {
    const env = state.environment as {
      loading: { value: boolean };
      ready: { value: boolean };
    };
    env.loading.value = true;
    const wrapper = render();
    const statusRow = wrapper.get("[data-alignment-status]").element;
    expect(wrapper.text()).not.toContain("modelsMissing");
    env.loading.value = false;
    env.ready.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.get("[data-alignment-status]").element).toBe(statusRow);
    expect(wrapper.text()).not.toContain("modelsMissing");
    env.ready.value = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.get("[data-alignment-status]").element).toBe(statusRow);
    expect(wrapper.get("[data-alignment-status]").text()).toContain("modelsMissing");
    expect(wrapper.get("[data-alignment-status]").text()).toContain("openModelSettings");
    wrapper.unmount();
  });
});
