import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { appVersion } from "@main/utils/config";
import { companionLabel } from "./musicContext";
import { createServer } from "./server";

/** 陪伴对话只向模型公开读取音乐信息的工具 */
const allowedTools = new Set([
  "get_playback_status",
  "get_now_playing",
  "get_current_lyric_context",
  "get_current_song_highlights",
  "get_queue",
  "search_library",
  "list_albums",
  "list_artists",
  "get_random_tracks",
]);

/** 使用正向字段清单，防止曲目路径、签名封面、流媒体账号信息进入模型上下文 */
const publicFields = new Set([
  "track",
  "tracks",
  "title",
  "artist",
  "artists",
  "album",
  "albums",
  "name",
  "trackCount",
  "duration",
  "source",
  "total",
  "offset",
  "currentIndex",
  "state",
  "position",
  "positionMs",
  "durationMs",
  "volume",
  "isFinished",
  "repeat",
  "shuffle",
  "playing",
  "speed",
  "lyricOffsetMs",
  "lyricAvailable",
  "lyricLineCount",
  "lines",
  "index",
  "startMs",
  "endMs",
  "text",
  "ok",
  "data",
  "segments",
  "kind",
  "platform",
  "confidence",
  "sources",
  "status",
]);

/**
 * 保留有限的音乐元数据、歌词和标注，排除文件地址及内部标识
 * @param value - 本机 MCP 工具返回的 JSON 值
 * @returns 可发送给所选模型的紧凑结果
 */
const modelView = (value: unknown): unknown => {
  if (typeof value === "string") return value.slice(0, 320);
  if (Array.isArray(value)) return value.slice(0, 32).map(modelView);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => publicFields.has(key))
      .map(([key, field]) => [
        key,
        (key === "title" || key === "name" || key === "artist") && typeof field === "string"
          ? companionLabel(field)
          : modelView(field),
      ]),
  );
};

/**
 * 将过长的工具结果截断并封装为不超过上限的合法 JSON，避免切裂代理对或因转义超限
 * @param json - 原始 JSON 文本
 * @param maxLength - 返回文本的字符数上限
 * @returns 长度不超过上限的合法 JSON 文本
 */
function truncateToolJson(json: string, maxLength = 16_000): string {
  if (json.length <= maxLength) return json;
  let limit = maxLength - 64;
  while (limit > 0) {
    const preview = json.slice(0, limit).replace(/[\uD800-\uDBFF]$/, "");
    const wrapped = JSON.stringify({ truncated: true, preview });
    if (wrapped.length <= maxLength) return wrapped;
    limit = Math.max(0, limit - Math.max(64, wrapped.length - maxLength));
  }
  return JSON.stringify({ truncated: true, preview: "" });
}

/**
 * 在进程内建立陪伴专用 MCP 会话，复用工具发现、参数验证与业务处理器
 * @param signal - 当前对话的取消信号
 * @returns 只读工具描述、受限调用入口及会话释放方法
 */
export const openCompanionTools = async (signal: AbortSignal) => {
  signal.throwIfAborted();
  const server = createServer();
  const client = new Client({ name: "listening-companion", version: appVersion });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sessionAbort = new AbortController();
  const forwardAbort = () => sessionAbort.abort(signal.reason);
  signal.addEventListener("abort", forwardAbort, { once: true });
  const options = { signal: sessionAbort.signal, timeout: 15_000 };
  /** 断开会话并释放双方监听器 */
  const close = async (): Promise<void> => {
    signal.removeEventListener("abort", forwardAbort);
    await Promise.all([client.close(), server.close()]);
  };
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport, options);
    const result = await client.listTools({}, options);
    const tools = result.tools
      .filter((tool) => allowedTools.has(tool.name) && tool.annotations?.readOnlyHint === true)
      .map(({ name, description, inputSchema }) => ({
        name,
        description: description ?? name,
        inputSchema,
      }));
    return {
      tools,
      close,
      /**
       * 检查本次发现的权限并通过 MCP 调用，限制结果规模和等待时间
       * @param name - 工具名称
       * @param args - 由工具输入 schema 校验的参数
       * @returns 供模型继续对话的 JSON 文本
       */
      async call(name: string, args: Record<string, unknown>): Promise<string> {
        signal.throwIfAborted();
        if (!tools.some((tool) => tool.name === name)) throw new Error("未授权的陪伴工具");
        const result = await client.callTool({ name, arguments: args }, undefined, options);
        signal.throwIfAborted();
        if (result.isError) throw new Error("音乐工具调用失败，请检查参数或稍后重试");
        const content = result.content;
        if (!Array.isArray(content) || content[0]?.type !== "text")
          throw new Error("音乐工具结果无效");
        return truncateToolJson(JSON.stringify(modelView(JSON.parse(content[0].text))));
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
};
