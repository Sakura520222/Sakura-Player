/**
 * 有界读取响应文本，取消时唤醒等待中的读取并释放锁
 * @param body - HTTP 响应流
 * @param signal - 请求的取消或超时信号
 * @param maxLength - 文本长度上限
 * @param onActivity - 活动重置回调
 * @returns 完整响应文本
 */
export const readResponseText = async (
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  maxLength: number,
  onActivity?: () => void,
): Promise<string> => {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    let text = "";
    while (true) {
      const chunk = await reader.read();
      onActivity?.();
      signal.throwIfAborted();
      text += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (text.length > maxLength) throw new Error("AI 响应超过大小限制");
      if (chunk.done) return text;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};
