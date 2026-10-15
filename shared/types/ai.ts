/** AI 模型接口协议 */
export type AiModelProtocol = "openai-compatible" | "anthropic";

/** AI 模型公开配置 */
export interface AiModelConfig {
  /** 本地配置 ID */
  id: string;
  /** 显示名称 */
  name: string;
  /** 接口协议 */
  protocol: AiModelProtocol;
  /** API 根地址 */
  baseUrl: string;
  /** 服务端模型 ID */
  model: string;
  /** 是否已经保存密钥 */
  hasApiKey: boolean;
}

/** AI 模型配置状态 */
export interface AiModelState {
  models: AiModelConfig[];
  activeModelId: string | null;
}

/** 新增或更新 AI 模型的输入 */
export interface AiModelSaveInput {
  id?: string;
  name: string;
  protocol: AiModelProtocol;
  baseUrl: string;
  model: string;
  /** 编辑时留空则保留已经保存的密钥 */
  apiKey?: string;
}

/** AI 模型 IPC 接口 */
export interface AiModelApi {
  list: () => Promise<AiModelState>;
  save: (input: AiModelSaveInput) => Promise<AiModelState>;
  remove: (id: string) => Promise<AiModelState>;
  setActive: (id: string | null) => Promise<AiModelState>;
  test: (request: AiConnectionTestRequest) => Promise<AiRequestResult<AiConnectionTestResult>>;
  complete: (request: AiCompletionRequest) => Promise<AiRequestResult<AiCompletionResult>>;
  /** 流式增量只发给当前调用；Promise 返回完整结果，监听器在请求结束时自动释放 */
  stream: (
    request: AiCompletionRequest,
    onDelta: (text: string) => void,
  ) => Promise<AiRequestResult<AiCompletionResult>>;
  cancel: (requestId: string) => Promise<boolean>;
}

/** 文本对话消息，system 消息须放在对话开头 */
export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 两种协议共用的文本生成参数 */
export interface AiCompletionInput {
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
}

/** requestId 在当前窗口中须唯一，modelId 留空时使用当前启用的模型 */
export interface AiCompletionRequest extends AiCompletionInput {
  requestId: string;
  modelId?: string;
}

export interface AiTokenUsage {
  /** 输入总量，包含服务端缓存读写的 token */
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiCompletionResult {
  text: string;
  model: string;
  /** 保留服务端的结束原因，如 stop、length、end_turn 或 max_tokens */
  finishReason: string | null;
  /** 服务端未提供用量时为 null */
  usage: AiTokenUsage | null;
}

/** 测试未保存的表单，编辑时密钥留空会复用该配置已经保存的密钥 */
export interface AiConnectionTestRequest {
  requestId: string;
  config: AiModelSaveInput;
}

export interface AiConnectionTestResult {
  model: string;
  latencyMs: number;
  usage: AiTokenUsage | null;
}

/** 取消与错误使用明确状态返回，避免 Electron 丢失异常的自定义字段 */
export type AiRequestResult<T> =
  { status: "completed"; data: T } | { status: "cancelled" } | { status: "error"; error: string };
