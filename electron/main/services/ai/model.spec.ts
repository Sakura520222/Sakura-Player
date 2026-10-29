import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiModelSaveInput } from "@shared/types/ai";

const mocks = vi.hoisted(() => ({
  disk: "",
  encryptionAvailable: true,
  linux: false,
  backend: "gnome_libsecret",
  decrypt: vi.fn(),
  encrypt: vi.fn(),
  write: vi.fn(),
  request: vi.fn(),
}));
vi.mock("node:fs", () => ({ default: { readFileSync: () => mocks.disk, existsSync: () => true } }));
vi.mock("atomically", () => ({
  writeFileSync: (_path: string, value: string) => {
    mocks.disk = value;
    mocks.write(value);
  },
}));
vi.mock("electron", () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => mocks.encryptionAvailable,
    getSelectedStorageBackend: () => mocks.backend,
    encryptStringAsync: mocks.encrypt,
    decryptStringAsync: mocks.decrypt,
  },
}));
vi.mock("@main/utils/paths", () => ({ configDir: "/test-config" }));
vi.mock("@main/utils/logger", () => ({ ipcLog: { error: vi.fn() } }));
vi.mock("@main/utils/config", () => ({
  get isLinux() {
    return mocks.linux;
  },
}));
vi.mock("./request", () => ({ requestAi: mocks.request }));

import {
  listAiModels,
  removeAiModel,
  resolveAiConnection,
  saveAiModel,
  setActiveAiModel,
} from "./model";
import { completeAi, testAiConnection } from "./index";

const input: AiModelSaveInput = {
  name: "测试",
  protocol: "openai-compatible",
  baseUrl: "https://example.com/gateway/v1/",
  model: "test-model",
  apiKey: "secret-test-key",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.disk = "";
  mocks.encryptionAvailable = true;
  mocks.linux = false;
  mocks.backend = "gnome_libsecret";
  mocks.decrypt.mockImplementation(async (buffer: Buffer) => ({
    result: buffer.toString().replace(/^encrypted:/, ""),
    shouldReEncrypt: false,
  }));
  mocks.encrypt.mockImplementation(async (value: string) => Buffer.from(`encrypted:${value}`));
  mocks.request.mockResolvedValue({
    text: "OK",
    model: "returned-model",
    finishReason: "stop",
    usage: null,
  });
});

describe("模型凭据与调用解析", () => {
  it("系统轮换密钥时重新加密，公开配置仍不包含密钥", async () => {
    const saved = await saveAiModel(input);
    mocks.decrypt.mockResolvedValue({ result: input.apiKey, shouldReEncrypt: true });
    mocks.encrypt.mockResolvedValue(Buffer.from("rotated-secret"));
    expect((await resolveAiConnection()).apiKey).toBe(input.apiKey);
    expect(JSON.parse(mocks.disk).models[0].encryptedApiKey).toBe(
      Buffer.from("rotated-secret").toString("base64"),
    );
    expect(listAiModels()).toEqual(saved);
  });

  it("轮换回写失败时仍能使用已解密的密钥", async () => {
    await saveAiModel(input);
    const original = mocks.disk;
    mocks.decrypt.mockResolvedValue({ result: input.apiKey, shouldReEncrypt: true });
    mocks.encrypt.mockRejectedValueOnce(new Error("系统存储暂不可用"));
    expect((await resolveAiConnection()).apiKey).toBe(input.apiKey);
    expect(mocks.disk).toBe(original);
  });

  it.each(["编辑", "删除"])("轮换期间%s模型不会被旧配置覆盖", async (action) => {
    const saved = await saveAiModel(input);
    const id = saved.models[0].id;
    const pending = Promise.withResolvers<Buffer>();
    mocks.decrypt.mockResolvedValue({ result: input.apiKey, shouldReEncrypt: true });
    mocks.encrypt.mockClear();
    mocks.encrypt.mockReturnValueOnce(pending.promise);
    const resolving = resolveAiConnection();
    await vi.waitFor(() => expect(mocks.encrypt).toHaveBeenCalledTimes(1));
    if (action === "删除") removeAiModel(id);
    else await saveAiModel({ ...input, id, apiKey: "new-key", name: "新配置" });
    const updated = mocks.disk;
    pending.resolve(Buffer.from("rotated-old-key"));
    await resolving;
    expect(mocks.disk).toBe(updated);
  });

  it("并发新增模型时保留每次保存的结果", async () => {
    await Promise.all([
      saveAiModel(input),
      saveAiModel({ ...input, name: "第二个", model: "second" }),
    ]);
    expect(listAiModels().models.map((model) => model.name)).toEqual(["测试", "第二个"]);
  });

  it("思考等级随模型保存、公开与解析，编辑或临时测试可改等级并复用密钥", async () => {
    const state = await saveAiModel({ ...input, reasoningEffort: "high" });
    const id = state.models[0].id;
    expect(state.models[0].reasoningEffort).toBe("high");
    expect(JSON.parse(mocks.disk).models[0].reasoningEffort).toBe("high");
    expect((await resolveAiConnection()).reasoningEffort).toBe("high");
    await testAiConnection(
      { ...input, id, apiKey: "", reasoningEffort: "xhigh" },
      new AbortController().signal,
    );
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      reasoningEffort: "xhigh",
      apiKey: input.apiKey,
    });
    expect(mocks.request.mock.calls[0][1].maxTokens).toBe(4096);
    expect(listAiModels()).toEqual(state);
    await saveAiModel({ ...input, id, apiKey: "", reasoningEffort: "default" });
    expect(await resolveAiConnection()).toMatchObject({
      reasoningEffort: "default",
      apiKey: input.apiKey,
    });
  });

  it("拒绝未知思考等级，Anthropic 配置不保留兼容协议专用参数", async () => {
    await expect(saveAiModel({ ...input, reasoningEffort: "invalid" as never })).rejects.toThrow();
    const state = await saveAiModel({ ...input, protocol: "anthropic", reasoningEffort: "high" });
    expect(state.models[0]).not.toHaveProperty("reasoningEffort");
    expect(await resolveAiConnection()).not.toHaveProperty("reasoningEffort");
  });

  it("Linux basic_text 不可保存或复用持久化密钥，临时测试仍可使用本次输入", async () => {
    const saved = await saveAiModel(input);
    mocks.write.mockClear();
    mocks.decrypt.mockClear();
    mocks.linux = true;
    mocks.backend = "basic_text";
    await expect(saveAiModel(input)).rejects.toThrow("安全存储不可用");
    await expect(saveAiModel({ ...input, id: saved.models[0].id, apiKey: "" })).rejects.toThrow(
      "安全存储不可用",
    );
    await expect(resolveAiConnection()).rejects.toThrow("安全存储不可用");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect((await resolveAiConnection(undefined, input)).apiKey).toBe(input.apiKey);
  });

  it("保存只写入加密密钥，公开状态和序列化配置没有明文密钥字段", async () => {
    const state = await saveAiModel(input);
    expect(state.models[0]).toMatchObject({
      hasApiKey: true,
      baseUrl: "https://example.com/gateway/v1",
    });
    expect(JSON.stringify(state)).not.toContain(input.apiKey);
    expect(mocks.disk).not.toContain(input.apiKey);
    expect(JSON.parse(mocks.disk).models[0]).not.toHaveProperty("apiKey");
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(await resolveAiConnection()).toEqual({
      protocol: input.protocol,
      model: input.model,
      baseUrl: "https://example.com/gateway/v1",
      apiKey: input.apiKey,
    });
  });

  it("编辑与临时测试留空密钥可复用原密钥，测试不会写入文件或切换当前模型", async () => {
    const original = await saveAiModel(input);
    const id = original.models[0].id;
    const draft = {
      ...input,
      id,
      apiKey: "",
      baseUrl: "http://localhost:1234/v1",
      model: "other-model",
    };
    mocks.write.mockClear();
    await testAiConnection(draft, new AbortController().signal);
    expect(mocks.request.mock.calls[0][0]).toMatchObject({
      baseUrl: draft.baseUrl,
      model: draft.model,
      apiKey: input.apiKey,
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(listAiModels()).toEqual(original);
    await saveAiModel(draft);
    expect((await resolveAiConnection()).apiKey).toBe(input.apiKey);
  });

  it("未保存配置可直接测试且不会成为当前模型", async () => {
    const result = await testAiConnection(input, new AbortController().signal);
    expect(result).toMatchObject({ model: "returned-model", usage: null });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(listAiModels()).toEqual({ activeModelId: null, models: [] });
  });

  it("指定模型优先于启用模型；停用或删除后不能再隐式调用", async () => {
    const first = (await saveAiModel(input)).models[0].id;
    const second = (await saveAiModel({ ...input, name: "第二个", model: "second" })).models[1].id;
    await completeAi(
      { requestId: "explicit", modelId: second, messages: [{ role: "user", content: "hi" }] },
      new AbortController().signal,
    );
    expect(mocks.request.mock.calls[0][0].model).toBe("second");
    expect(listAiModels().activeModelId).toBe(first);
    setActiveAiModel(null);
    await expect(resolveAiConnection()).rejects.toThrow("启用 AI 模型");
    expect((await resolveAiConnection(second)).model).toBe("second");
    setActiveAiModel(second);
    removeAiModel(second);
    await expect(resolveAiConnection()).rejects.toThrow("启用 AI 模型");
    await expect(resolveAiConnection(second)).rejects.toThrow("不存在");
  });

  it("安全存储不可用时拒绝保存，解密失败不会泄漏底层错误", async () => {
    mocks.encryptionAvailable = false;
    await expect(saveAiModel(input)).rejects.toThrow("安全存储不可用");
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.encryptionAvailable = true;
    await saveAiModel(input);
    mocks.decrypt.mockImplementation(() => {
      throw new Error("secret-test-key internal stack");
    });
    await expect(resolveAiConnection()).rejects.toThrow("请重新填写 API Key");
  });

  it.each([
    "https://user:password@example.com/v1",
    "https://example.com/v1?key=secret",
    "https://example.com/v1#key",
    "https://",
    "file:///tmp/model",
  ])("拒绝无效或夹带凭据的地址：%s", async (baseUrl) => {
    await expect(saveAiModel({ ...input, baseUrl })).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
