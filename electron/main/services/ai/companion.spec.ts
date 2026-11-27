import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConnection } from "./model";
import { runCompanionAgent } from "./companion";
import { resolveAiConnection } from "./model";
import { fetchWithProxy } from "@main/utils/proxy";
import { openCompanionTools } from "@main/services/mcp/companionTools";

vi.mock("./model", () => ({ resolveAiConnection: vi.fn() }));
vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: vi.fn() }));
vi.mock("@main/services/mcp/companionTools", () => ({ openCompanionTools: vi.fn() }));

const getLyrics = "get_current_lyric_context";
const schema = { type: "object" as const, properties: {} };
const session = {
  tools: [getLyrics, "search_library"].map((name) => ({
    name,
    description: name,
    inputSchema: schema,
  })),
  call: vi.fn(async (_name: string, _args: Record<string, unknown>) => '{"line":"听风"}'),
  close: vi.fn(async () => {}),
};
const input = {
  history: [
    { role: "user" as const, text: "上一句是什么？" },
    { role: "assistant" as const, text: "云" },
  ],
  prompt: "这一句呢？",
  context: "风",
  proactive: false,
};
const model: AiConnection = {
  protocol: "openai-compatible",
  model: "fixture",
  apiKey: "test-key",
  baseUrl: "http://localhost",
};

/**
 * 将协议事件编码为真实 SSE 帧
 * @param events - 按顺序发送的 JSON 或流结束标记
 * @returns 模拟模型服务的流式响应
 */
function sse(...events: unknown[]) {
  return new Response(
    events.map((e) => "data: " + (typeof e === "string" ? e : JSON.stringify(e)) + "\n\n").join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

/**
 * 创建分片函数参数和用量齐全的 OpenAI 工具调用响应
 * @param name - 模型生成的工具名
 * @param reason - 服务端结束原因
 * @returns 兼容协议的 SSE 响应
 */
function openAiCall(name = getLyrics, reason = "tool_calls") {
  return sse(
    {
      choices: [
        {
          delta: {
            reasoning_content: "tool selection",
            tool_calls: [{ index: 0, id: "call1", function: { name, arguments: '{"before":' } }],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: null, function: { name: null, arguments: "1}" } }],
          },
          finish_reason: reason,
        },
      ],
    },
    { choices: [], usage: { prompt_tokens: 9, completion_tokens: 1, total_tokens: 10 } },
    "[DONE]",
  );
}

/**
 * 创建 OpenAI 文本结束响应
 * @param text - 最后一轮模型回复
 * @returns 带用量的测试响应
 */
function openAiText(text: string) {
  return sse(
    {
      choices: [{ delta: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    },
    "[DONE]",
  );
}

/**
 * 获取指定轮次发向模型的 JSON 请求体
 * @param round - 从零开始的轮次
 * @returns 用于断言工具声明和聊天历史的负载
 */
function body(round: number) {
  return JSON.parse(String(vi.mocked(fetchWithProxy).mock.calls[round][1]?.body));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchWithProxy).mockReset();
  vi.mocked(resolveAiConnection).mockResolvedValue(model);
  vi.mocked(openCompanionTools).mockResolvedValue(session);
});

describe("陪伴模型工具循环", () => {
  it("OpenAI 保留历史、分片工具调用、推理与匹配的回包，并合计用量", async () => {
    vi.mocked(fetchWithProxy)
      .mockResolvedValueOnce(openAiCall())
      .mockResolvedValueOnce(openAiText("听风"));
    const drafts = vi.fn();
    const result = await runCompanionAgent(input, new AbortController().signal, drafts);
    expect(result).toEqual({
      text: "听风",
      usage: { inputTokens: 14, outputTokens: 3, totalTokens: 17 },
    });
    expect(body(0).messages.slice(1, 3)).toEqual(
      input.history.map(({ role, text }) => ({ role, content: text })),
    );
    expect(body(0).tools[0]).toMatchObject({
      type: "function",
      function: { name: getLyrics, parameters: schema },
    });
    expect(session.call).toHaveBeenCalledExactlyOnceWith(getLyrics, { before: 1 });
    expect(body(1).messages.slice(-2)).toEqual([
      {
        role: "assistant",
        content: null,
        reasoning_content: "tool selection",
        tool_calls: [
          {
            type: "function",
            id: "call1",
            function: { name: getLyrics, arguments: '{"before":1}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call1", content: '{"line":"听风"}' },
    ]);
    expect(drafts).toHaveBeenLastCalledWith("听风");
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("Anthropic 聚合 input_json_delta，用 tool_result 回复对应的 tool_use", async () => {
    vi.mocked(resolveAiConnection).mockResolvedValue({ ...model, protocol: "anthropic" });
    const start = {
      type: "message_start",
      message: { model: "fixture", usage: { input_tokens: 3 } },
    };
    const end = { type: "message_stop" };
    vi.mocked(fetchWithProxy)
      .mockResolvedValueOnce(
        sse(
          start,
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking", thinking: "", signature: "" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "thinking_delta", thinking: "synthetic" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "signature_delta", signature: "signed" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "redacted_thinking", data: "opaque" },
          },
          { type: "content_block_stop", index: 1 },
          {
            type: "content_block_start",
            index: 2,
            content_block: { type: "tool_use", id: "use1", name: getLyrics, input: {} },
          },
          {
            type: "content_block_delta",
            index: 2,
            delta: { type: "input_json_delta", partial_json: '{"after":' },
          },
          {
            type: "content_block_delta",
            index: 2,
            delta: { type: "input_json_delta", partial_json: "2}" },
          },
          { type: "content_block_stop", index: 2 },
          { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } },
          {
            type: "content_block_delta",
            index: 3,
            delta: { type: "text_delta", text: "看看歌词" },
          },
          { type: "content_block_stop", index: 3 },
          {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 2 },
          },
          end,
        ),
      )
      .mockResolvedValueOnce(
        sse(
          start,
          { type: "content_block_start", content_block: { type: "text", text: "听风" } },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 1 },
          },
          end,
        ),
      );
    const result = await runCompanionAgent(input, new AbortController().signal);
    expect(body(0).tools[0]).toEqual({
      name: getLyrics,
      description: getLyrics,
      input_schema: schema,
    });
    expect(body(1).messages.slice(-2)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "synthetic", signature: "signed" },
          { type: "redacted_thinking", data: "opaque" },
          { type: "tool_use", id: "use1", name: getLyrics, input: { after: 2 } },
          { type: "text", text: "看看歌词" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "use1", content: '{"line":"听风"}', is_error: false },
        ],
      },
    ]);
    expect(result).toEqual({
      text: "听风",
      usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 },
    });
  });

  it.each(["play", "search_library"])(
    "主动会话拒绝模型伪造调用 %s，并且允许保持沉默",
    async (name) => {
      vi.mocked(fetchWithProxy)
        .mockResolvedValueOnce(openAiCall(name))
        .mockResolvedValueOnce(openAiText("[SILENT]"));
      const draft = vi.fn();
      const result = await runCompanionAgent(
        { ...input, proactive: true },
        new AbortController().signal,
        draft,
      );
      expect(body(0).tools).toHaveLength(1);
      expect(session.call).not.toHaveBeenCalled();
      expect(body(1).messages.at(-1).content).toContain("error");
      expect(result.text).toBe("");
      expect(draft).not.toHaveBeenCalled();
    },
  );

  it("缺少任一轮用量时不把部分小计显示为总量", async () => {
    vi.mocked(fetchWithProxy)
      .mockResolvedValueOnce(openAiCall())
      .mockResolvedValueOnce(
        sse({ choices: [{ delta: { content: "你好" }, finish_reason: "stop" }] }, "[DONE]"),
      );
    expect((await runCompanionAgent(input, new AbortController().signal)).usage).toBeNull();
  });

  it("兼容服务的签名工具调用按完整分片回传", async () => {
    const extra = { google: { thought_signature: "opaque-test-signature" } };
    vi.mocked(fetchWithProxy)
      .mockResolvedValueOnce(
        sse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      type: "function",
                      id: "call1",
                      extra_content: extra,
                      function: { name: getLyrics, arguments: "{}" },
                    },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          "[DONE]",
        ),
      )
      .mockResolvedValueOnce(openAiText("听风"));
    await runCompanionAgent(input, new AbortController().signal);
    expect(body(1).messages.at(-2).tool_calls[0].extra_content).toEqual(extra);
    expect(session.call).toHaveBeenCalledExactlyOnceWith(getLyrics, {});
  });

  it("截断的工具调用无法执行", async () => {
    vi.mocked(fetchWithProxy).mockResolvedValueOnce(openAiCall(getLyrics, "length"));
    await expect(runCompanionAgent(input, new AbortController().signal)).rejects.toThrow("未完整");
    expect(session.call).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("模型持续调用工具时封顶并释放会话", async () => {
    vi.mocked(fetchWithProxy).mockImplementation(async () => openAiCall());
    await expect(runCompanionAgent(input, new AbortController().signal)).rejects.toThrow("上限");
    expect(session.call).toHaveBeenCalledTimes(3);
    expect(body(3).tools).toEqual(body(0).tools);
    expect(body(3).tool_choice).toBe("none");
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("Anthropic 一次返回八个并行调用时保留工具定义，最后一轮仅允许生成文本", async () => {
    vi.mocked(resolveAiConnection).mockResolvedValue({ ...model, protocol: "anthropic" });
    const start = {
      type: "message_start",
      message: { model: "fixture", usage: { input_tokens: 1 } },
    };
    const end = { type: "message_stop" };
    const calls = Array.from({ length: 8 }, (_, index) => [
      {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: "id-" + index, name: getLyrics, input: {} },
      },
      { type: "content_block_stop", index },
    ]).flat();
    vi.mocked(fetchWithProxy)
      .mockResolvedValueOnce(
        sse(
          start,
          ...calls,
          {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 8 },
          },
          end,
        ),
      )
      .mockResolvedValueOnce(
        sse(
          start,
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "听风" } },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 1 },
          },
          end,
        ),
      );
    const result = await runCompanionAgent(input, new AbortController().signal);
    expect(result.text).toBe("听风");
    expect(session.call).toHaveBeenCalledTimes(8);
    expect(
      body(1)
        .messages.at(-1)
        .content.map((block: { tool_use_id: string }) => block.tool_use_id),
    ).toEqual(Array.from({ length: 8 }, (_, index) => "id-" + index));
    expect(body(1).tools).toEqual(body(0).tools);
    expect(body(1).tool_choice).toEqual({ type: "none" });
  });

  it("Anthropic 参数截断时不伪造空对象回传签名轮次", async () => {
    vi.mocked(resolveAiConnection).mockResolvedValue({ ...model, protocol: "anthropic" });
    vi.mocked(fetchWithProxy).mockResolvedValueOnce(
      sse(
        { type: "message_start", message: { model: "fixture", usage: { input_tokens: 1 } } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "id", name: getLyrics, input: {} },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"after":' },
        },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ),
    );
    await expect(runCompanionAgent(input, new AbortController().signal)).rejects.toThrow(
      "工具参数无效",
    );
    expect(session.call).not.toHaveBeenCalled();
    expect(fetchWithProxy).toHaveBeenCalledOnce();
  });

  it("执行工具时取消，即使工具晚返回也不会继续请求模型", async () => {
    const controller = new AbortController();
    vi.mocked(fetchWithProxy).mockResolvedValueOnce(openAiCall());
    session.call.mockImplementationOnce(async () => {
      controller.abort();
      return "stale";
    });
    await expect(runCompanionAgent(input, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchWithProxy).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("合并相邻同角色历史并过滤 Anthropic 空文本块", async () => {
    vi.mocked(resolveAiConnection).mockResolvedValue({ ...model, protocol: "anthropic" });
    const start = {
      type: "message_start",
      message: { model: "fixture", usage: { input_tokens: 2 } },
    };
    const end = { type: "message_stop" };
    vi.mocked(fetchWithProxy)
      .mockResolvedValueOnce(
        sse(
          start,
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_stop", index: 0 },
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "use1", name: getLyrics, input: {} },
          },
          { type: "content_block_stop", index: 1 },
          {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 1 },
          },
          end,
        ),
      )
      .mockResolvedValueOnce(
        sse(
          start,
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "好的" } },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn" },
            usage: { output_tokens: 1 },
          },
          end,
        ),
      );
    const result = await runCompanionAgent(
      {
        ...input,
        history: [
          { role: "assistant", text: "主动一" },
          { role: "assistant", text: "主动二" },
          { role: "user", text: "失败的提问" },
        ],
      },
      new AbortController().signal,
    );
    expect(result.text).toBe("好的");
    expect(body(0).messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(body(0).messages[1].content).toBe("主动一\n\n主动二");
    expect(body(0).messages[2].content).toContain("失败的提问");
    expect(body(1).messages.at(-2).content).toEqual([
      { type: "tool_use", id: "use1", name: getLyrics, input: {} },
    ]);
  });

  it("兼容空串 finish_reason 与显式 null 工具索引，且无工具时不发 tool_choice", async () => {
    vi.mocked(fetchWithProxy)
      .mockResolvedValueOnce(
        sse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: null,
                      id: "call1",
                      extra_content: { google: { thought_signature: null } },
                      function: { name: getLyrics, arguments: "{}" },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "" }] },
          "[DONE]",
        ),
      )
      .mockResolvedValueOnce(openAiText("完成"));
    const result = await runCompanionAgent(input, new AbortController().signal);
    expect(result.text).toBe("完成");
    expect(session.call).toHaveBeenCalledExactlyOnceWith(getLyrics, {});
  });
});
