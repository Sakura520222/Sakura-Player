const MAX_EVENT_LENGTH = 1024 * 1024;

/**
 * 逐行解析 SSE，兼容分片 UTF-8、CRLF、注释和多行 data
 * @param body - 服务端响应流
 * @param signal - 取消信号
 * @returns SSE 事件迭代器
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  let eventLength = 0;
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    let eof = false;
    while (!eof) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      eof = chunk.done;
      buffer += eof ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        signal.throwIfAborted();
        if (!eof && match[0] === "\r" && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
          eventLength = 0;
        } else if (!line.startsWith(":")) {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          eventLength += line.length;
          if (eventLength > MAX_EVENT_LENGTH) throw new Error("AI 流式事件超过大小限制");
          if (field === "data") data.push(value);
          else if (field === "event") event = value;
        }
      }
      if (buffer.length + eventLength > MAX_EVENT_LENGTH) {
        throw new Error("AI 流式事件超过大小限制");
      }
    }
    // 部分兼容服务在最后一条事件后直接关闭连接，不补空行。
    if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, ""));
    signal.throwIfAborted();
    if (data.length) yield { event, data: data.join("\n") };
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
