import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiConnectionTestResult,
  AiModelSaveInput,
} from "@shared/types/ai";
import { resolveAiConnection } from "./model";
import { requestAi } from "./request";

/**
 * 使用指定模型或当前启用模型完成文本对话
 * @param request - 对话参数与可选模型 ID
 * @param signal - 调用方取消信号
 * @param onDelta - 可选文本增量回调
 * @returns 统一文本结果
 */
export const completeAi = (
  request: AiCompletionRequest,
  signal: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<AiCompletionResult> =>
  requestAi(resolveAiConnection(request.modelId), request, signal, onDelta);

/**
 * 通过一次小规模真实生成验证地址、认证与模型可用性，不保存表单
 * @param config - 临时表单或带已保存 ID 的配置
 * @param signal - 调用方取消信号
 * @returns 服务端模型名称、耗时与用量
 */
export const testAiConnection = async (
  config: AiModelSaveInput,
  signal: AbortSignal,
): Promise<AiConnectionTestResult> => {
  if (!config || typeof config !== "object") throw new Error("AI 模型测试配置无效");
  const connection = resolveAiConnection(undefined, config);
  const start = performance.now();
  const result = await requestAi(
    connection,
    {
      messages: [{ role: "user", content: "Reply with OK only." }],
      maxTokens:
        connection.reasoningEffort && !["default", "none"].includes(connection.reasoningEffort)
          ? 4096
          : 128,
    },
    signal,
  );
  return {
    model: result.model,
    latencyMs: Math.round(performance.now() - start),
    usage: result.usage,
  };
};
