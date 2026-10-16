import { z } from "zod";
import { fetchWithProxy } from "@main/utils/proxy";
import type { AiCompletionInput, AiCompletionResult, AiTokenUsage } from "@shared/types/ai";
import type { AiConnection } from "./model";
import { completionSchema } from "./validation";
import { readSse } from "./sse";
import { readResponseText } from "./body";

const MAX_RESPONSE_LENGTH = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ERROR_LENGTH = 8192;
const parameterErrorSchema = z.object({
  message: z.string(),
  param: z.string().nullish(),
});
const usageSchema = z.object({
  prompt_tokens: z.number().nonnegative(),
  completion_tokens: z.number().nonnegative(),
  total_tokens: z.number().nonnegative(),
});
const deltaSchema = z.object({
  content: z.string().nullable().optional(),
  refusal: z.string().nullable().optional(),
});
const openAiSchema = z.object({
  model: z.string().optional(),
  choices: z.array(
    z.object({
      index: z.number().optional(),
      delta: deltaSchema.optional(),
      message: deltaSchema.optional(),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
  usage: usageSchema.nullable().optional(),
});
const anthropicUsageSchema = z.object({
  input_tokens: z.number().nonnegative().optional(),
  output_tokens: z.number().nonnegative().optional(),
  cache_creation_input_tokens: z.number().nonnegative().nullish(),
  cache_read_input_tokens: z.number().nonnegative().nullish(),
});
const anthropicSchema = z.object({
  model: z.string(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string().nullable(),
  usage: anthropicUsageSchema,
});
const anthropicEventTypeSchema = z.object({ type: z.string() });
const anthropicEventSchema = anthropicEventTypeSchema.extend({
  message: z.object({ model: z.string(), usage: anthropicUsageSchema }).optional(),
  content_block: z.object({ type: z.string(), text: z.string().optional() }).optional(),
  delta: z
    .object({
      type: z.string().optional(),
      text: z.string().optional(),
      stop_reason: z.string().nullable().optional(),
    })
    .optional(),
  usage: anthropicUsageSchema.optional(),
});

/**
 * 调用文本模型；传入 onDelta 时按 SSE 增量返回，同时汇总完整结果
 * @param connection - 仅主进程持有的模型连接配置
 * @param input - 对话及生成参数
 * @param signal - 调用方取消信号
 * @param onDelta - 文本增量回调
 * @returns 统一文本结果与服务端用量
 */
export const requestAi = async (
  connection: AiConnection,
  input: AiCompletionInput,
  signal: AbortSignal,
  onDelta?: (text: string) => void,
): Promise<AiCompletionResult> => {
  const parsed = completionSchema.safeParse(input);
  if (!parsed.success) throw new Error("AI 对话参数无效：请检查消息顺序、内容大小和生成参数");
  const options = parsed.data;
  const anthropic = connection.protocol === "anthropic";
  if (anthropic && options.temperature !== undefined && options.temperature > 1) {
    throw new Error("Anthropic 的 temperature 必须介于 0 和 1 之间");
  }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = AbortSignal.any([signal, timeout]);
  const body: Record<string, unknown> = {
    model: connection.model,
    messages: anthropic
      ? options.messages.filter((message) => message.role !== "system")
      : options.messages,
    stream: Boolean(onDelta),
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (anthropic || options.maxTokens !== undefined) body.max_tokens = options.maxTokens ?? 4096;
  if (!anthropic && connection.reasoningEffort && connection.reasoningEffort !== "default") {
    body.reasoning_effort = connection.reasoningEffort;
  }
  if (anthropic) {
    const system = options.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content);
    if (system.length) body.system = system.join("\n\n");
  } else if (onDelta) body.stream_options = { include_usage: true };

  let response: Response | undefined;
  let model = connection.model;
  let finishReason: string | null = null;
  let usage: AiTokenUsage | null = null;
  let anthropicUsage: z.infer<typeof anthropicUsageSchema> = {};
  const texts: string[] = [];
  let textLength = 0;
  const append = (text: string): void => {
    requestSignal.throwIfAborted();
    textLength += text.length;
    if (textLength > MAX_RESPONSE_LENGTH) throw new Error("AI 响应超过大小限制");
    if (text) {
      texts.push(text);
      onDelta?.(text);
    }
  };
  const updateAnthropicUsage = (value: z.infer<typeof anthropicUsageSchema>): void => {
    anthropicUsage = { ...anthropicUsage, ...value };
    // Anthropic 将缓存读写与普通输入分别计数，后续增量中的用量是累计值。
    const inputTokens =
      (anthropicUsage.input_tokens ?? 0) +
      (anthropicUsage.cache_creation_input_tokens ?? 0) +
      (anthropicUsage.cache_read_input_tokens ?? 0);
    const outputTokens = anthropicUsage.output_tokens ?? 0;
    usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  };

  try {
    requestSignal.throwIfAborted();
    while (true) {
      requestSignal.throwIfAborted();
      response = await fetchWithProxy(
        `${connection.baseUrl}/${anthropic ? "messages" : "chat/completions"}`,
        {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            Accept: onDelta ? "text/event-stream" : "application/json",
            ...(anthropic
              ? { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01" }
              : { Authorization: `Bearer ${connection.apiKey}` }),
          },
          body: JSON.stringify(body),
          signal: requestSignal,
        },
      );
      if (response.ok) break;
      const httpError = new Error(
        `AI 请求失败（HTTP ${response.status}），请检查服务地址、模型、密钥及额度`,
      );
      if (anthropic || response.status !== 400 || !response.body) throw httpError;

      let rejectedField: string | undefined;
      let rejectedReasoning = false;
      try {
        const value: unknown = JSON.parse(
          await readResponseText(response.body, requestSignal, MAX_ERROR_LENGTH),
        );
        const payload =
          value && typeof value === "object" && "error" in value ? value.error : value;
        const parsedError = parameterErrorSchema.safeParse(payload);
        if (parsedError.success) {
          const { message, param } = parsedError.data;
          rejectedReasoning =
            "reasoning_effort" in body &&
            (param === "reasoning_effort" || (!param && /\breasoning_effort\b/.test(message)));
          if (
            /unsupported|not supported|unknown|unrecognized|unexpected|not permitted|not allowed/i.test(
              message,
            )
          ) {
            rejectedField = ["max_tokens", "stream_options"].find(
              (field) =>
                field in body &&
                (param
                  ? param === field || (field === "stream_options" && param.startsWith(`${field}.`))
                  : new RegExp(`\\b${field}\\b`).test(message)),
            );
          }
        }
      } catch {
        requestSignal.throwIfAborted();
      }
      if (rejectedReasoning)
        throw new Error("模型或服务不支持所选思考等级，请在 AI 模型配置中调整等级或使用服务默认");
      // 只调整被明确拒绝的可选字段，各字段最多调整一次，不重放已开始的生成。
      if (rejectedField === "max_tokens") {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
      } else if (rejectedField === "stream_options") {
        delete body.stream_options;
      } else throw httpError;
    }
    if (!response.body) throw new Error("AI 服务返回了空响应");

    if (!onDelta) {
      const json = await readResponseText(response.body, requestSignal, MAX_RESPONSE_LENGTH);
      const value: unknown = JSON.parse(json);
      if (anthropic) {
        const result = anthropicSchema.parse(value);
        model = result.model;
        finishReason = result.stop_reason;
        updateAnthropicUsage(result.usage);
        for (const block of result.content) if (block.type === "text") append(block.text ?? "");
      } else {
        const result = openAiSchema.parse(value);
        const choice = result.choices[0];
        if (!choice?.message) throw new Error("AI 服务未返回有效的文本结果");
        model = result.model ?? model;
        finishReason = choice.finish_reason ?? null;
        if (result.usage)
          usage = {
            inputTokens: result.usage.prompt_tokens,
            outputTokens: result.usage.completion_tokens,
            totalTokens: result.usage.total_tokens,
          };
        append(choice.message.content ?? choice.message.refusal ?? "");
      }
    } else {
      if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
        throw new Error("AI 服务未返回 SSE 流式响应");
      }
      let completed = false;
      let started = false;
      for await (const event of readSse(response.body, requestSignal)) {
        requestSignal.throwIfAborted();
        if (!event.data.trim()) continue;
        if (!anthropic && event.data.trim() === "[DONE]") {
          completed = true;
          break;
        }
        const raw: unknown = JSON.parse(event.data);
        if (
          event.event === "error" ||
          (!anthropic && raw && typeof raw === "object" && "error" in raw && raw.error)
        ) {
          throw new Error("AI 服务在生成过程中返回错误，请稍后重试");
        }
        if (anthropic) {
          const type = anthropicEventTypeSchema.parse(raw).type;
          if (
            ![
              "message_start",
              "content_block_start",
              "content_block_delta",
              "message_delta",
              "message_stop",
              "error",
            ].includes(type)
          )
            continue;
          const value = anthropicEventSchema.parse(raw);
          if (value.type === "message_start" && value.message) {
            started = true;
            model = value.message.model;
            updateAnthropicUsage(value.message.usage);
          } else if (value.type === "content_block_start" && value.content_block?.type === "text") {
            append(value.content_block.text ?? "");
          } else if (value.type === "content_block_delta" && value.delta?.type === "text_delta") {
            append(value.delta.text ?? "");
          } else if (value.type === "message_delta") {
            finishReason = value.delta?.stop_reason ?? finishReason;
            if (value.usage) updateAnthropicUsage(value.usage);
          } else if (value.type === "message_stop") {
            completed = true;
            break;
          } else if (value.type === "error") {
            throw new Error("AI 服务在生成过程中返回错误，请稍后重试");
          }
        } else {
          const value = openAiSchema.parse(raw);
          model = value.model ?? model;
          const choice = value.choices.find((item) => (item.index ?? 0) === 0);
          if (choice) {
            started = true;
            append(choice.delta?.content ?? choice.delta?.refusal ?? "");
            finishReason = choice.finish_reason ?? finishReason;
          }
          if (value.usage)
            usage = {
              inputTokens: value.usage.prompt_tokens,
              outputTokens: value.usage.completion_tokens,
              totalTokens: value.usage.total_tokens,
            };
        }
      }
      if (!started || (!completed && (anthropic || !finishReason))) {
        throw new Error("AI 流式响应意外中断，结果可能不完整");
      }
    }
    requestSignal.throwIfAborted();
    return { text: texts.join(""), model, finishReason, usage };
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    if (timeout.aborted) throw new Error("AI 请求超时，请稍后重试");
    if (error instanceof z.ZodError) throw new Error("AI 服务响应结构无效，请检查接口协议兼容性");
    if (error instanceof SyntaxError)
      throw new Error("AI 服务返回了无法解析的 JSON，请检查接口服务");
    if (
      error instanceof TypeError &&
      "code" in error &&
      error.code === "ERR_ENCODING_INVALID_ENCODED_DATA"
    )
      throw new Error("AI 服务响应文本编码无效，请检查接口服务");
    if (error instanceof TypeError) throw new Error("AI 网络连接失败，请检查网络、代理或接口服务");
    const message = error instanceof Error ? error.message : "AI 请求失败，请稍后重试";
    throw new Error(message.replaceAll(connection.apiKey, "[REDACTED]").slice(0, 500));
  } finally {
    await response?.body?.cancel().catch(() => {});
  }
};
