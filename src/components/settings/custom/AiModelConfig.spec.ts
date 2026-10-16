import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConnectionTestResult, AiRequestResult } from "@shared/types/ai";
import AiModelConfig from "./AiModelConfig.vue";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
  cancel: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/composables/useToast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

const mountConfig = () =>
  mount(AiModelConfig, {
    global: {
      plugins: [
        createI18n({ legacy: false, locale: "zh-CN", missingWarn: false, fallbackWarn: false }),
      ],
      stubs: {
        SDialog: {
          props: ["open"],
          emits: ["update:open"],
          template:
            '<div v-if="open" data-dialog><slot/><slot name="footer" :close="() => $emit(\'update:open\', false)"/></div>',
        },
        SButton: { props: ["disabled"], template: '<button :disabled="disabled"><slot/></button>' },
        SInput: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        SSelect: {
          props: ["modelValue", "options"],
          emits: ["update:modelValue"],
          template:
            '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :value="option.value">{{ option.label }}</option></select>',
        },
        SFormItem: { template: "<label><slot/></label>" },
        STag: { template: "<span><slot/></span>" },
      },
    },
  });
type Wrapper = ReturnType<typeof mountConfig>;
const click = async (wrapper: Wrapper, text: string, inDialog = false) => {
  const scope = inDialog ? wrapper.find("[data-dialog]") : wrapper;
  await scope
    .findAll("button")
    .find((button) => button.text() === text)!
    .trigger("click");
};

beforeEach(() => {
  vi.clearAllMocks();
  window.api = {
    aiModel: { list: mocks.list, save: mocks.save, test: mocks.test, cancel: mocks.cancel },
  } as unknown as Window["api"];
  mocks.list.mockResolvedValue({
    activeModelId: "saved",
    models: [
      {
        id: "saved",
        name: "已保存",
        protocol: "openai-compatible",
        baseUrl: "http://localhost/v1",
        model: "test-model",
        hasApiKey: true,
      },
    ],
  });
  mocks.cancel.mockResolvedValue(true);
});

describe("模型连接测试界面", () => {
  it("编辑旧配置默认跟随服务，修改等级后测试与保存都携带选择且复用密钥", async () => {
    const wrapper = mountConfig();
    await flushPromises();
    await click(wrapper, "common.edit");
    const effort = wrapper.get<HTMLSelectElement>("[data-reasoning-effort]");
    expect(effort.element.value).toBe("default");
    await effort.setValue("high");
    mocks.test.mockResolvedValue({
      status: "completed",
      data: { model: "test-model", latencyMs: 1, usage: null },
    });
    await click(wrapper, "settings.aiModel.test", true);
    await flushPromises();
    expect(mocks.test.mock.calls[0][0].config).toMatchObject({
      id: "saved",
      reasoningEffort: "high",
      apiKey: "",
    });
    mocks.save.mockResolvedValue({
      activeModelId: "saved",
      models: [{ ...mocks.test.mock.calls[0][0].config, hasApiKey: true }],
    });
    await click(wrapper, "common.save", true);
    await flushPromises();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEffort: "high", apiKey: "" }),
    );
    await click(wrapper, "common.edit");
    expect(wrapper.get<HTMLSelectElement>("[data-reasoning-effort]").element.value).toBe("high");
    wrapper.unmount();
  });

  it("Anthropic 表单不显示兼容协议的思考等级", async () => {
    const wrapper = mountConfig();
    await flushPromises();
    await click(wrapper, "common.edit");
    await wrapper.find("select").setValue("anthropic");
    expect(wrapper.find("[data-reasoning-effort]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("已保存配置可直接测试，不要求再次填写密钥", async () => {
    mocks.test.mockResolvedValue({
      status: "completed",
      data: { model: "test-model", latencyMs: 10, usage: null },
    });
    const wrapper = mountConfig();
    await flushPromises();
    await click(wrapper, "settings.aiModel.test");
    await flushPromises();
    expect(mocks.test.mock.calls[0][0].config).toMatchObject({ id: "saved", model: "test-model" });
    expect(mocks.test.mock.calls[0][0].config.apiKey).toBeUndefined();
    expect(mocks.success).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it.each(["close", "edit", "unmount"])(
    "%s 时取消在途测试且迟到结果不显示为成功",
    async (action) => {
      let finish!: (result: AiRequestResult<AiConnectionTestResult>) => void;
      mocks.test.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const wrapper = mountConfig();
      await flushPromises();
      await click(wrapper, "common.edit");
      await click(wrapper, "settings.aiModel.test", true);
      expect(mocks.test).toHaveBeenCalledOnce();
      if (action === "close") await click(wrapper, "common.cancel", true);
      else if (action === "edit") await wrapper.findAll("input")[0].setValue("changed");
      else wrapper.unmount();
      await flushPromises();
      expect(mocks.cancel).toHaveBeenCalledWith(mocks.test.mock.calls[0][0].requestId);
      finish({ status: "completed", data: { model: "old-model", latencyMs: 10, usage: null } });
      await flushPromises();
      expect(mocks.success).not.toHaveBeenCalled();
      if (action !== "unmount") {
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        wrapper.unmount();
      }
    },
  );

  it("点击取消测试后展示取消状态，保存按钮在测试期间禁用", async () => {
    let finish!: (result: AiRequestResult<AiConnectionTestResult>) => void;
    mocks.test.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const wrapper = mountConfig();
    await flushPromises();
    await click(wrapper, "common.edit");
    await click(wrapper, "settings.aiModel.test", true);
    const save = wrapper.findAll("button").find((button) => button.text() === "common.save")!;
    expect(save.attributes("disabled")).toBeDefined();
    await click(wrapper, "settings.aiModel.cancelTest", true);
    expect(mocks.cancel).toHaveBeenCalledOnce();
    finish({ status: "cancelled" });
    await flushPromises();
    expect(wrapper.find('[role="status"]').text()).toBe("settings.aiModel.testCancelled");
    expect(save.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });
});
