import { z } from "zod";

export const MAX_COMPANION_CALLS = 8;

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  signature?: string;
}

const openAiEvent = z.object({
  choices: z.array(
    z.object({
      index: z.number().optional(),
      delta: z
        .object({
          reasoning_content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().int().nonnegative().nullish(),
                extra_content: z
                  .object({
                    google: z.object({ thought_signature: z.string().nullish() }).nullish(),
                  })
                  .nullish(),
                id: z.string().nullish(),
                function: z
                  .object({ name: z.string().nullish(), arguments: z.string().nullish() })
                  .nullish(),
              }),
            )
            .nullish(),
        })
        .nullish(),
    }),
  ),
});

const anthropicBlock = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  text: z.string().optional(),
  thinking: z.string().optional(),
  signature: z.string().optional(),
});
const anthropicEvent = z.object({
  type: z.string(),
  index: z.number().int().nonnegative().optional(),
  content_block: anthropicBlock.optional(),
  delta: z
    .object({
      type: z.string().optional(),
      partial_json: z.string().optional(),
      text: z.string().optional(),
      thinking: z.string().optional(),
      signature: z.string().optional(),
    })
    .optional(),
});

/** 按工具索引合并单次 SSE 响应中可能交错到达的调用片段 */
export class ToolCallStream {
  private readonly calls = new Map<number, ToolCall>();
  private readonly blocks = new Map<number, z.infer<typeof anthropicBlock>>();
  private blockLength = 0;
  reasoning = "";

  /**
   * 接收单个协议事件，在执行任何工具前校验数量和参数体积
   * @param raw - 已解码的 SSE 事件
   * @param anthropic - 是否采用 Messages 协议
   */
  accept(raw: unknown, anthropic: boolean): void {
    if (!anthropic) {
      const delta = openAiEvent.parse(raw).choices.find((item) => (item.index ?? 0) === 0)?.delta;
      this.reasoning += delta?.reasoning_content ?? "";
      if (this.reasoning.length > 64_000) throw new Error("AI 工具推理内容超过大小限制");
      for (const chunk of delta?.tool_calls ?? []) {
        let index = chunk.index;
        if (index == null) {
          // 部分兼容接口在完整调用里只返回 ID，无 ID 的续片必须能唯一定位
          if (chunk.id) {
            const prior = [...this.calls].find(([, call]) => call.id === chunk.id);
            index = prior?.[0] ?? Math.max(-1, ...this.calls.keys()) + 1;
          } else if (this.calls.size === 1 && delta?.tool_calls?.length === 1) {
            index = this.calls.keys().next().value;
          }
          if (index == null) throw new Error("AI 工具调用索引无效");
        }
        const call = this.append(index, chunk.id, chunk.function?.name, chunk.function?.arguments);
        const signature = chunk.extra_content?.google?.thought_signature;
        if (signature) {
          if (signature.length > 1_048_576) throw new Error("AI 工具签名超过大小限制");
          call.signature = signature;
        }
      }
      return;
    }

    const { type, index, content_block: block, delta } = anthropicEvent.parse(raw);
    if (type === "content_block_start" && block) {
      const key = index ?? 0;
      if (this.blocks.has(key) || this.blocks.size >= 256)
        throw new Error("AI 内容块索引或数量无效");
      this.blocks.set(key, block);
      this.blockLength += JSON.stringify(block).length;
      if (block.type === "tool_use") {
        if (index === undefined) throw new Error("AI 工具调用索引无效");
        this.append(
          index,
          block.id,
          block.name,
          block.input && Object.keys(block.input).length ? JSON.stringify(block.input) : "",
        );
      }
    } else if (type === "content_block_delta" && delta) {
      const current = this.blocks.get(index ?? 0);
      if (delta.type === "input_json_delta") {
        if (index === undefined || !this.calls.has(index))
          throw new Error("AI 工具参数缺少调用声明");
        this.append(index, null, null, delta.partial_json);
      } else if (current) {
        if (delta.type === "text_delta" && delta.text !== undefined) {
          current.text = (current.text ?? "") + delta.text;
          this.blockLength += delta.text.length;
        } else if (delta.type === "thinking_delta" && delta.thinking !== undefined) {
          current.thinking = (current.thinking ?? "") + delta.thinking;
          this.blockLength += delta.thinking.length;
        } else if (delta.type === "signature_delta" && delta.signature !== undefined) {
          current.signature = (current.signature ?? "") + delta.signature;
          this.blockLength += delta.signature.length;
        }
      }
    }
    if (this.blockLength > 2 * 1024 * 1024) throw new Error("AI 内容块超过大小限制");
  }

  /**
   * 按原顺序回传当前助手轮，保留推理块及其原始签名
   * @param uses - 已解析参数的工具块，按服务端索引排列
   * @returns 用于 Messages 续轮的原生内容块
   */
  anthropicContent(uses: Record<string, unknown>[]): Record<string, unknown>[] {
    let toolIndex = 0;
    return [...this.blocks]
      .sort(([a], [b]) => a - b)
      .filter(([, block]) => block.type !== "text" || Boolean(block.text))
      .map(([, block]) => (block.type === "tool_use" ? { ...block, ...uses[toolIndex++] } : block));
  }

  /**
   * 将分片累积到同一次调用，限制工具调用在内存中的大小
   * @param index - 模型响应中的调用索引
   * @param id - 服务端调用编号片段
   * @param name - 函数名片段
   * @param args - JSON 参数片段
   * @returns 已合并的调用
   */
  private append(
    index: number,
    id?: string | null,
    name?: string | null,
    args?: string | null,
  ): ToolCall {
    const call = this.calls.get(index) ?? { id: "", name: "", arguments: "" };
    const repeatedHeader = Boolean(id && id === call.id);
    if (!repeatedHeader) call.id += id ?? "";
    if (!repeatedHeader || name !== call.name) call.name += name ?? "";
    call.arguments += args ?? "";
    this.calls.set(index, call);
    if (
      this.calls.size > MAX_COMPANION_CALLS ||
      call.id.length > 256 ||
      call.name.length > 128 ||
      call.arguments.length > 8192
    )
      throw new Error("AI 工具调用超过大小或数量限制");
    return call;
  }

  /**
   * 只接收模型显式完成的调用批次，避免执行截断或重复的指令
   * @param reason - 模型报告的结束原因
   * @param anthropic - 是否采用 Messages 协议
   * @returns 按模型顺序排列的工具调用
   */
  finish(
    reason: string | null,
    anthropic: boolean,
  ): (ToolCall & { input: Record<string, unknown> | null })[] {
    const calls = [...this.calls].sort(([a], [b]) => a - b).map(([, call]) => call);
    const completed = anthropic
      ? reason === "tool_use"
      : reason === "tool_calls" || (reason === "stop" && calls.length > 0);
    if (
      completed !== Boolean(calls.length) ||
      calls.some((call) => !call.id || !call.name) ||
      new Set(calls.map((call) => call.id)).size !== calls.length
    ) {
      throw new Error("AI 工具调用未完整返回，请重试");
    }
    return calls.map((call) => {
      let input: Record<string, unknown> | null = null;
      try {
        const parsed: unknown = JSON.parse(call.arguments || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          input = parsed as Record<string, unknown>;
      } catch {
        // Chat Completions 可原样带回错误参数，让模型修正该次调用
      }
      if (anthropic && !input) throw new Error("AI 工具参数无效，无法回传原始工具块");
      return { ...call, input };
    });
  }
}
