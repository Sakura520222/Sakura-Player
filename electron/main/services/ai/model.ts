import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { configDir } from "@main/utils/paths";
import { ipcLog } from "@main/utils/logger";
import { isLinux } from "@main/utils/config";
import { decryptSecret, encryptSecret, isSecureStorageAvailable } from "@main/utils/secureStorage";
import { normalizeModelInput } from "./validation";
import type {
  AiModelConfig,
  AiModelSaveInput,
  AiModelState,
  AiReasoningEffort,
} from "@shared/types/ai";

const STORAGE_FILE = path.join(configDir, "ai-models.json");

interface PersistedAiModel {
  id: string;
  name: string;
  protocol: AiModelSaveInput["protocol"];
  baseUrl: string;
  model: string;
  reasoningEffort?: AiReasoningEffort;
  encryptedApiKey: string;
}

interface PersistedAiModelState {
  models: PersistedAiModel[];
  activeModelId: string | null;
}

const emptyState = (): PersistedAiModelState => ({ models: [], activeModelId: null });

const readPersisted = (): PersistedAiModelState => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedAiModelState;
    if (!Array.isArray(raw?.models)) return emptyState();
    const activeModelId = raw.models.some((model) => model.id === raw.activeModelId)
      ? raw.activeModelId
      : null;
    return { models: raw.models, activeModelId };
  } catch {
    return emptyState();
  }
};

const writePersisted = (state: PersistedAiModelState): void => {
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    atomicWriteSync(STORAGE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    ipcLog.error("写入 AI 模型配置失败:", error);
    throw new Error("AI 模型配置保存失败");
  }
};

/** basic_text 使用固定口令，不能作为保存或复用密钥的安全后端 */
const ensureSecureStorage = async (): Promise<void> => {
  if (
    !(await isSecureStorageAvailable()) ||
    (isLinux && safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new Error("系统安全存储不可用，无法保存 API Key");
  }
};

/**
 * 加密模型密钥，拒绝不安全的系统存储后端
 * @param apiKey - 待保存的密钥
 * @returns Base64 编码的密文
 */
const encryptApiKey = async (apiKey: string): Promise<string> => {
  await ensureSecureStorage();
  return (await encryptSecret(apiKey)).toString("base64");
};

/**
 * 返回含思考等级的公开配置，凭据仅返回是否已保存
 * @param state - 持久化模型状态
 * @returns 不包含密钥的配置列表
 */
const toPublicState = (state: PersistedAiModelState): AiModelState => ({
  activeModelId: state.activeModelId,
  models: state.models.map<AiModelConfig>((model) => ({
    id: model.id,
    name: model.name,
    protocol: model.protocol,
    baseUrl: model.baseUrl,
    model: model.model,
    ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
    hasApiKey: Boolean(model.encryptedApiKey),
  })),
});

/** 主进程内部使用的解密配置，不得通过 IPC 返回 */
export interface AiConnection {
  protocol: AiModelSaveInput["protocol"];
  baseUrl: string;
  model: string;
  reasoningEffort?: AiReasoningEffort;
  apiKey: string;
}

/**
 * 读取已保存模型或校验临时表单，只有调用前才解密密钥
 * @param modelId - 指定配置 ID，留空时读取启用配置
 * @param draft - 只用于本次请求的临时表单
 * @returns 仅供主进程内部使用的连接配置
 */
export const resolveAiConnection = async (
  modelId?: string,
  draft?: AiModelSaveInput,
): Promise<AiConnection> => {
  const state = readPersisted();
  const id = draft ? draft.id : (modelId ?? state.activeModelId);
  const saved = id ? state.models.find((item) => item.id === id) : undefined;
  if (id && !saved) throw new Error("AI 模型配置不存在");
  if (!draft && !saved) throw new Error("请先配置并启用 AI 模型");
  const config = normalizeModelInput(draft ?? saved!);
  let apiKey = draft?.apiKey?.trim();
  if (!apiKey && saved?.encryptedApiKey) {
    await ensureSecureStorage();
    let decrypted: { plainText: string; needsReEncrypt: boolean };
    try {
      decrypted = await decryptSecret(Buffer.from(saved.encryptedApiKey, "base64"));
    } catch {
      throw new Error("无法解密 AI 模型密钥，请重新填写 API Key");
    }
    apiKey = decrypted.plainText;
    if (decrypted.needsReEncrypt) {
      try {
        const encryptedApiKey = (await encryptSecret(apiKey)).toString("base64");
        // 加密期间可能编辑、删除或切换模型，只更新仍持有原密文的配置
        const latest = readPersisted();
        const current = latest.models.find((item) => item.id === saved.id);
        if (current?.encryptedApiKey === saved.encryptedApiKey) {
          current.encryptedApiKey = encryptedApiKey;
          writePersisted(latest);
        }
      } catch {
        // 轮换回写失败不影响本次调用，下次读取时继续尝试
      }
    }
  }
  if (!apiKey) throw new Error("请填写 API Key");
  return {
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    model: config.model,
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    apiKey,
  };
};

/**
 * 获取 AI 模型配置
 * @returns 不包含密钥明文的模型配置
 */
export const listAiModels = (): AiModelState => toPublicState(readPersisted());

/**
 * 保存 AI 模型配置
 * @param input - 模型配置输入
 * @returns 保存后的模型配置状态
 */
export const saveAiModel = async (input: AiModelSaveInput): Promise<AiModelState> => {
  const normalized = normalizeModelInput(input);
  const newApiKey = input.apiKey?.trim();
  const newEncryptedApiKey = newApiKey ? await encryptApiKey(newApiKey) : undefined;
  if (!newApiKey) await ensureSecureStorage();
  // 等待系统加密后再读取最新配置，避免并发保存覆盖其他模型
  const state = readPersisted();
  const existing = input.id ? state.models.find((item) => item.id === input.id) : undefined;
  if (input.id && !existing) throw new Error("AI 模型配置不存在");

  const encryptedApiKey = newEncryptedApiKey ?? existing?.encryptedApiKey ?? "";
  if (!encryptedApiKey) throw new Error("请填写 API Key");

  const saved: PersistedAiModel = {
    id: existing?.id ?? randomUUID(),
    ...normalized,
    encryptedApiKey,
  };
  if (existing) state.models.splice(state.models.indexOf(existing), 1, saved);
  else state.models.push(saved);
  if (!state.activeModelId) state.activeModelId = saved.id;
  writePersisted(state);
  return toPublicState(state);
};

/**
 * 删除 AI 模型配置
 * @param id - 本地配置 ID
 * @returns 删除后的模型配置状态
 */
export const removeAiModel = (id: string): AiModelState => {
  const state = readPersisted();
  state.models = state.models.filter((model) => model.id !== id);
  if (state.activeModelId === id) state.activeModelId = null;
  writePersisted(state);
  return toPublicState(state);
};

/**
 * 设置当前使用的 AI 模型
 * @param id - 本地配置 ID，传入 null 表示不启用模型
 * @returns 更新后的模型配置状态
 */
export const setActiveAiModel = (id: string | null): AiModelState => {
  const state = readPersisted();
  if (id !== null && !state.models.some((model) => model.id === id)) {
    throw new Error("AI 模型配置不存在");
  }
  state.activeModelId = id;
  writePersisted(state);
  return toPublicState(state);
};
