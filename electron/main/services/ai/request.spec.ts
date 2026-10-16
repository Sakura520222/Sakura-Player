// @vitest-environment node
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithProxy } from "@main/utils/proxy";
import type { AiConnection } from "./model";
import { requestAi } from "./request";
import { readSse } from "./sse";

vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: vi.fn() }));

const message = { role: "user" as const, content: "你好" };
const openAiResult = {
  model: "returned-model",
  choices: [{ message: { content: "你好🌸" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
};
const anthropicResult = {
  model: "claude-test",
  content: [{ type: "thinking" }, { type: "text", text: "你好🌸" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 5, output_tokens: 3 },
};
let connection: AiConnection;
let respond: (response: ServerResponse) => void;
let received: { path: string; headers: Record<string, unknown>; body: Record<string, unknown> };
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  received = { path: request.url!, headers: request.headers, body: JSON.parse(body) };
  respond(response);
});

const sse = (value: unknown, event?: string) =>
  `${event ? `event: ${event}\r\n` : ""}data: ${typeof value === "string" ? value : JSON.stringify(value)}\r\n\r\n`;
const openAiStream = () =>
  ": keepalive\r\n\r\n" +
  sse({ choices: [{ index: 0, delta: { role: "assistant", content: "你" } }] }) +
  sse({ choices: [{ index: 0, delta: { content: "好🌸" }, finish_reason: "stop" }] }) +
  sse({ choices: [], usage: openAiResult.usage }) +
  sse("[DONE]");
const anthropicStream = () =>
  [
    {
      type: "message_start",
      message: { model: "claude-test", usage: { input_tokens: 5, output_tokens: 1 } },
    },
    { type: "ping" },
    { type: "future_event" },
    { type: "content_block_start", content_block: { type: "text", text: "你" } },
    { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "ignored" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "好🌸" } },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
    { type: "message_stop" },
  ]
    .map((value) => sse(value, value.type))
    .join("");

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
});
beforeEach(() => {
  vi.restoreAllMocks();
  received = { path: "", headers: {}, body: {} };
  vi.mocked(fetchWithProxy).mockImplementation((url, init) => fetch(url, init));
  const address = server.address() as { port: number };
  connection = {
    protocol: "openai-compatible",
    baseUrl: `http://127.0.0.1:${address.port}/gateway/v1`,
    model: "test-model",
    apiKey: "test-secret",
  };
  respond = (response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(openAiResult));
  };
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("统一模型请求", () => {
  it.each([
    ["schema", "响应结构无效"],
    ["json", "无法解析的 JSON"],
    ["encoding", "文本编码无效"],
    ["network", "网络连接失败"],
  ])("%s 失败给出独立类别且不暴露密钥或服务端原文", async (kind, expected) => {
    if (kind === "network") {
      vi.mocked(fetchWithProxy).mockRejectedValueOnce(new TypeError("fetch failed test-secret"));
    } else {
      respond = (response) =>
        response.end(
          kind === "encoding"
            ? Buffer.from([0xff])
            : kind === "json"
              ? "not-json test-secret"
              : JSON.stringify({ choices: "test-secret" }),
        );
    }
    let failure: unknown;
    try {
      await requestAi(connection, { messages: [message] }, new AbortController().signal);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(expected);
    expect((failure as Error).message).not.toContain("test-secret");
  });

  it("OpenAI 请求保留自定义路径、对话与生成参数，归一化文本和用量", async () => {
    const result = await requestAi(
      connection,
      {
        messages: [{ role: "system", content: "系统提示" }, message],
        maxTokens: 64,
        temperature: 0.5,
      },
      new AbortController().signal,
    );
    expect(received.path).toBe("/gateway/v1/chat/completions");
    expect(received.headers.authorization).toBe("Bearer test-secret");
    expect(received.body).toMatchObject({
      model: "test-model",
      stream: false,
      max_tokens: 64,
      temperature: 0.5,
    });
    expect(received.body.messages).toHaveLength(2);
    expect(result).toEqual({
      text: "你好🌸",
      model: "returned-model",
      finishReason: "stop",
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    });
  });

  it("Anthropic 使用独立认证、顶层 system 和必需的 max_tokens", async () => {
    connection.protocol = "anthropic";
    respond = (response) => response.end(JSON.stringify(anthropicResult));
    const result = await requestAi(
      connection,
      { messages: [{ role: "system", content: "一" }, { role: "system", content: "二" }, message] },
      new AbortController().signal,
    );
    expect(received.path).toBe("/gateway/v1/messages");
    expect(received.headers).toMatchObject({
      "x-api-key": "test-secret",
      "anthropic-version": "2023-06-01",
    });
    expect(received.headers.authorization).toBeUndefined();
    expect(received.body).toMatchObject({
      system: "一\n\n二",
      messages: [message],
      max_tokens: 4096,
    });
    expect(result).toEqual({
      text: "你好🌸",
      model: "claude-test",
      finishReason: "end_turn",
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    });
  });

  it.each(["openai-compatible", "anthropic"] as const)(
    "%s SSE 文本与普通调用一致，收到结束标记立即释放连接",
    async (protocol) => {
      connection.protocol = protocol;
      let closed = false;
      respond = (response) => {
        response.setHeader("Content-Type", "text/event-stream");
        response.on("close", () => {
          closed = true;
        });
        response.write(protocol === "anthropic" ? anthropicStream() : openAiStream());
      };
      const deltas: string[] = [];
      const result = await requestAi(
        connection,
        { messages: [message] },
        new AbortController().signal,
        (text) => deltas.push(text),
      );
      expect(deltas.join("")).toBe("你好🌸");
      expect(result.text).toBe(deltas.join(""));
      expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 3, totalTokens: 8 });
      await vi.waitFor(() => expect(closed).toBe(true));
    },
  );

  it("流中多次累计用量不会相加重复计算", async () => {
    connection.protocol = "anthropic";
    respond = (response) => {
      response.setHeader("Content-Type", "text/event-stream");
      response.end(
        anthropicStream().replace(
          sse({ type: "message_stop" }, "message_stop"),
          sse({ type: "message_delta", usage: { output_tokens: 7 } }) +
            sse({ type: "message_stop" }),
        ),
      );
    };
    const result = await requestAi(
      connection,
      { messages: [message] },
      new AbortController().signal,
      () => {},
    );
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 7, totalTokens: 12 });
  });

  it.each([false, true])(
    "Anthropic 缓存输入计入总量，流式累计不会重复相加：stream=%s",
    async (stream) => {
      connection.protocol = "anthropic";
      respond = (response) => {
        if (stream) {
          response.setHeader("Content-Type", "text/event-stream");
          response.end(
            anthropicStream().replace(
              '"input_tokens":5,"output_tokens":1',
              '"input_tokens":5,"output_tokens":1,"cache_creation_input_tokens":10,"cache_read_input_tokens":20',
            ),
          );
        } else
          response.end(
            JSON.stringify({
              ...anthropicResult,
              usage: {
                input_tokens: 5,
                output_tokens: 3,
                cache_creation_input_tokens: 10,
                cache_read_input_tokens: 20,
              },
            }),
          );
      };
      const result = await requestAi(
        connection,
        { messages: [message] },
        new AbortController().signal,
        stream ? () => {} : undefined,
      );
      expect(result.usage).toEqual({ inputTokens: 35, outputTokens: 3, totalTokens: 38 });
    },
  );

  it("缺少用量时返回 null，不伪造零用量", async () => {
    respond = (response) => response.end(JSON.stringify({ choices: openAiResult.choices }));
    const result = await requestAi(
      connection,
      { messages: [message] },
      new AbortController().signal,
    );
    expect(result.usage).toBeNull();
    expect(result.model).toBe("test-model");
  });

  it("HTTP 错误不会向调用方泄露服务端回显的密钥或正文", async () => {
    respond = (response) => {
      response.statusCode = 401;
      response.end(JSON.stringify({ error: { message: "test-secret private prompt" } }));
    };
    const error = await requestAi(
      connection,
      { messages: [message] },
      new AbortController().signal,
    ).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toMatch(/test-secret|private prompt/);
  });

  it.each(["openai-compatible", "anthropic"] as const)(
    "%s 处理中途服务错误不会变成成功结果",
    async (protocol) => {
      connection.protocol = protocol;
      respond = (response) => {
        response.setHeader("Content-Type", "text/event-stream");
        response.end(sse({ type: "error", error: { message: "test-secret" } }, "error"));
      };
      await expect(
        requestAi(connection, { messages: [message] }, new AbortController().signal, () => {}),
      ).rejects.toThrow("生成过程中返回错误");
    },
  );

  it.each(["openai-compatible", "anthropic"] as const)("%s 提前断流明确报错", async (protocol) => {
    connection.protocol = protocol;
    respond = (response) => {
      response.setHeader("Content-Type", "text/event-stream");
      response.end(
        protocol === "anthropic"
          ? sse({ type: "message_start", message: { model: "x", usage: { input_tokens: 1 } } })
          : sse({ choices: [{ delta: { content: "partial" } }] }),
      );
    };
    await expect(
      requestAi(connection, { messages: [message] }, new AbortController().signal, () => {}),
    ).rejects.toThrow("意外中断");
  });

  it("等待响应头期间取消会关闭真实 HTTP 请求", async () => {
    let closed = false;
    respond = (response) => {
      response.on("close", () => {
        closed = true;
      });
    };
    const controller = new AbortController();
    const task = requestAi(connection, { messages: [message] }, controller.signal);
    const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(received.body.messages).toEqual([message]));
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  it.each(["openai-compatible", "anthropic"] as const)(
    "%s 中途取消不会返回部分成功",
    async (protocol) => {
      connection.protocol = protocol;
      respond = (response) => {
        response.setHeader("Content-Type", "text/event-stream");
        response.write(
          protocol === "anthropic"
            ? sse({ type: "message_start", message: { model: "x", usage: { input_tokens: 1 } } }) +
                sse({ type: "content_block_delta", delta: { type: "text_delta", text: "partial" } })
            : sse({ choices: [{ delta: { content: "partial" } }] }),
        );
      };
      const controller = new AbortController();
      await expect(
        requestAi(connection, { messages: [message] }, controller.signal, () => controller.abort()),
      ).rejects.toMatchObject({ name: "AbortError" });
    },
  );

  it("请求超时与用户取消有不同错误语义", async () => {
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    vi.mocked(fetchWithProxy).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          });
        }),
    );
    const task = requestAi(connection, { messages: [message] }, new AbortController().signal);
    const rejected = expect(task).rejects.toThrow("超时");
    timeout.abort();
    await rejected;
  });

  it.each(["json", "html", "oversized"])("拒绝无效响应：%s", async (kind) => {
    respond = (response) => {
      response.setHeader("Content-Type", kind === "html" ? "text/html" : "application/json");
      response.end(kind === "oversized" ? "x".repeat(2 * 1024 * 1024 + 1) : "<html>invalid</html>");
    };
    await expect(
      requestAi(
        connection,
        { messages: [message] },
        new AbortController().signal,
        kind === "html" ? () => {} : undefined,
      ),
    ).rejects.toThrow();
  });

  it("禁止重定向转发密钥", async () => {
    respond = (response) => {
      response.statusCode = 307;
      response.setHeader("Location", "/other-host");
      response.end();
    };
    await expect(
      requestAi(connection, { messages: [message] }, new AbortController().signal),
    ).rejects.toThrow();
    expect(vi.mocked(fetchWithProxy).mock.calls.at(-1)![1]!.redirect).toBe("error");
  });

  it.each([
    { messages: [] },
    { messages: [{ role: "system", content: "only-system" }] },
    { messages: [message, { role: "system", content: "late" }] },
    { messages: [message], maxTokens: -1 },
    { messages: [message], temperature: NaN },
  ])("无效参数在发出网络请求前被拒绝：%j", async (input) => {
    vi.mocked(fetchWithProxy).mockClear();
    await expect(
      requestAi(connection, input as Parameters<typeof requestAi>[1], new AbortController().signal),
    ).rejects.toThrow("参数无效");
    expect(fetchWithProxy).not.toHaveBeenCalled();
  });
});

describe("SSE 边界", () => {
  it("取消后不能继续吐出同一缓冲区中的其他事件", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\ndata: second\n\n"));
      },
    });
    const controller = new AbortController();
    const reader = readSse(stream, controller.signal);
    expect((await reader.next()).value?.data).toBe("first");
    controller.abort();
    await expect(reader.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.locked).toBe(false);
  });

  it("逐字节 UTF-8、跨片 CRLF、多行 data、注释与无尾空行均可解析", async () => {
    const bytes = new TextEncoder().encode(
      ': ping\r\nevent: delta\r\ndata: {\r\ndata: "text":"你好🌸"}\r\n\r\ndata: [DONE]',
    );
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) controller.close();
        else controller.enqueue(bytes.slice(offset, ++offset));
      },
    });
    const events: { event: string; data: string }[] = [];
    for await (const event of readSse(stream, new AbortController().signal)) events.push(event);
    expect(events).toEqual([
      { event: "delta", data: '{\n"text":"你好🌸"}' },
      { event: "message", data: "[DONE]" },
    ]);
  });

  it("取消能唤醒挂起的 read 并释放读取器", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const controller = new AbortController();
    const reader = readSse(stream, controller.signal);
    const task = reader.next();
    const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it("无界事件被拒绝且底层流被取消", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data:" + "x".repeat(1024 * 1024)));
      },
      cancel: cancelled,
    });
    await expect(readSse(stream, new AbortController().signal).next()).rejects.toThrow("大小限制");
    expect(cancelled).toHaveBeenCalledOnce();
  });
});

describe("调用层审查回归", () => {
  it("Anthropic 未知事件携带任意未来字段时不会终止文本生成", async () => {
    connection.protocol = "anthropic";
    const future = {
      type: "future_event",
      error: { information: "future metadata" },
      delta: { text: { format: "future" }, stop_reason: 123 },
      usage: "future usage",
    };
    const content = anthropicStream().replace(
      sse({ type: "future_event" }, "future_event"),
      sse(future, "future_event"),
    );
    vi.mocked(fetchWithProxy).mockResolvedValue(
      new Response(content, { headers: { "Content-Type": "text/event-stream" } }),
    );
    const result = await requestAi(
      connection,
      { messages: [message] },
      new AbortController().signal,
      () => {},
    );
    expect(result.text).toBe("你好🌸");
  });

  it("两个可选字段先后被拒绝时最多发出三次请求", async () => {
    let attempts = 0;
    respond = (response) => {
      attempts++;
      const field =
        "max_tokens" in received.body
          ? "max_tokens"
          : "stream_options" in received.body
            ? "stream_options"
            : null;
      if (field) {
        response.statusCode = 400;
        response.end(
          JSON.stringify({ error: { param: field, message: `Unsupported parameter: ${field}` } }),
        );
      } else {
        response.setHeader("Content-Type", "text/event-stream");
        response.end(openAiStream());
      }
    };
    const result = await requestAi(
      connection,
      { messages: [message], maxTokens: 64 },
      new AbortController().signal,
      () => {},
    );
    expect(result.text).toBe("你好🌸");
    expect(attempts).toBe(3);
    expect(received.body).toMatchObject({ max_completion_tokens: 64 });
  });

  it.each([400, 401, 429, 500])("HTTP %s 的普通错误不能触发重放或泄漏响应正文", async (status) => {
    let attempts = 0;
    respond = (response) => {
      attempts++;
      response.statusCode = status;
      response.end(
        JSON.stringify({
          error: {
            param: "max_tokens",
            message:
              status === 400
                ? "max_tokens must be less than 10; test-secret private prompt"
                : "Unsupported parameter max_tokens; test-secret private prompt",
          },
        }),
      );
    };
    const result = await requestAi(
      connection,
      { messages: [message], maxTokens: 64 },
      new AbortController().signal,
    ).catch((error: Error) => error);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain(String(status));
    expect((result as Error).message).not.toMatch(/test-secret|private prompt/);
    expect(attempts).toBe(1);
  });

  it("读取参数错误正文时取消，不会发出适配后的下一次请求", async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(fetchWithProxy).mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            started();
          },
          cancel: cancelled,
        }),
        { status: 400 },
      ),
    );
    vi.mocked(fetchWithProxy).mockClear();
    const task = requestAi(connection, { messages: [message], maxTokens: 64 }, controller.signal);
    const rejected = expect(task).rejects.toMatchObject({ name: "AbortError" });
    await reading;
    controller.abort();
    await rejected;
    expect(fetchWithProxy).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("超大参数错误正文被中断且不触发适配重试", async () => {
    const cancelled = vi.fn();
    vi.mocked(fetchWithProxy).mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(8193)));
          },
          cancel: cancelled,
        }),
        { status: 400 },
      ),
    );
    vi.mocked(fetchWithProxy).mockClear();
    await expect(
      requestAi(connection, { messages: [message], maxTokens: 64 }, new AbortController().signal),
    ).rejects.toThrow("HTTP 400");
    expect(fetchWithProxy).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each(["openai-compatible", "anthropic"] as const)(
    "%s 取消后不再调用同一网络数据块中的文本回调",
    async (protocol) => {
      connection.protocol = protocol;
      vi.mocked(fetchWithProxy).mockResolvedValue(
        new Response(protocol === "anthropic" ? anthropicStream() : openAiStream(), {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
      const controller = new AbortController();
      const deltas: string[] = [];
      await expect(
        requestAi(connection, { messages: [message] }, controller.signal, (text) => {
          deltas.push(text);
          controller.abort();
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(deltas).toEqual(["你"]);
    },
  );

  it("仅在服务端明确拒绝旧 token 参数时适配新版字段", async () => {
    let attempts = 0;
    respond = (response) => {
      attempts++;
      if ("max_tokens" in received.body) {
        response.statusCode = 400;
        response.end(
          JSON.stringify({
            error: {
              param: "max_tokens",
              message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.",
            },
          }),
        );
      } else response.end(JSON.stringify(openAiResult));
    };
    const result = await requestAi(
      connection,
      { messages: [message], maxTokens: 64 },
      new AbortController().signal,
    );
    expect(result.text).toBe("你好🌸");
    expect(received.body.max_completion_tokens).toBe(64);
    expect(received.body).not.toHaveProperty("max_tokens");
    expect(attempts).toBe(2);
  });

  it.each(["stream_options", "stream_options.include_usage"])(
    "兼容端明确不支持可选字段 %s 时仍可流式输出",
    async (param) => {
      let attempts = 0;
      respond = (response) => {
        attempts++;
        if ("stream_options" in received.body) {
          response.statusCode = 400;
          response.end(
            JSON.stringify({
              error: { param, message: "Unknown parameter: " + param },
            }),
          );
        } else {
          response.setHeader("Content-Type", "text/event-stream");
          response.end(openAiStream());
        }
      };
      const result = await requestAi(
        connection,
        { messages: [message] },
        new AbortController().signal,
        () => {},
      );
      expect(result.text).toBe("你好🌸");
      expect(attempts).toBe(2);
    },
  );

  it("忽略空 SSE 心跳，不把合法空事件当成 JSON 错误", async () => {
    vi.mocked(fetchWithProxy).mockResolvedValue(
      new Response("data:\n\n" + openAiStream(), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const result = await requestAi(
      connection,
      { messages: [message] },
      new AbortController().signal,
      () => {},
    );
    expect(result.text).toBe("你好🌸");
  });
});
