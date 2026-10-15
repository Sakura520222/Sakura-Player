import { z } from "zod";
import type { AiModelSaveInput } from "@shared/types/ai";

export const requestIdSchema = z.string().regex(/^[\w-]{1,64}$/);

const modelSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  apiKey: z.string().max(4096).optional(),
  name: z.string().trim().min(1).max(200),
  protocol: z.enum(["openai-compatible", "anthropic"]),
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1).max(256),
});

/** 校验地址时拒绝 URL 凭据和查询参数，避免密钥被拼入请求地址或错误信息 */
export const normalizeModelInput = (input: AiModelSaveInput) => {
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) throw new Error("请填写有效的模型名称、接口协议、API 地址和模型 ID");
  const url = new URL(parsed.data.baseUrl);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("API 地址必须为不含账号、查询参数或片段的 HTTP(S) 地址");
  }
  const { name, protocol, model } = parsed.data;
  return { name, protocol, model, baseUrl: url.href.replace(/\/+$/, "") };
};

export const completionSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z
            .string()
            .min(1)
            .max(1024 * 1024),
        }),
      )
      .min(1)
      .max(200),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .superRefine(({ messages }, ctx) => {
    let conversationStarted = false;
    let length = 0;
    for (const message of messages) {
      length += message.content.length;
      if (message.role !== "system") conversationStarted = true;
      else if (conversationStarted)
        ctx.addIssue({ code: "custom", message: "system 消息必须在开头" });
    }
    if (!conversationStarted || length > 1024 * 1024) {
      ctx.addIssue({ code: "custom", message: "对话内容为空或超过大小限制" });
    }
  });
