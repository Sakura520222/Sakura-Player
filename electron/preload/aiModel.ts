import { ipcRenderer } from "electron";
import type { AiModelApi } from "@shared/types/ai";

const streams = new Set<string>();

export const aiModelApi: AiModelApi = {
  list: () => ipcRenderer.invoke("aiModel:list"),
  save: (input) => ipcRenderer.invoke("aiModel:save", input),
  remove: (id) => ipcRenderer.invoke("aiModel:remove", id),
  setActive: (id) => ipcRenderer.invoke("aiModel:setActive", id),
  test: (request) => ipcRenderer.invoke("aiModel:test", request),
  complete: (request) => ipcRenderer.invoke("aiModel:complete", request),
  cancel: (requestId) => ipcRenderer.invoke("aiModel:cancel", requestId),
  stream: async (request, onDelta) => {
    const id = request?.requestId;
    if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id)) {
      return { status: "error", error: "AI 请求 ID 无效" };
    }
    if (streams.has(id) || streams.size >= 8) {
      return { status: "error", error: "AI 请求 ID 已在使用中或并发请求过多" };
    }
    if (typeof onDelta !== "function") return { status: "error", error: "AI 流式回调无效" };
    streams.add(id);
    const channel = `aiModel:delta:${id}`;
    let callbackFailed = false;
    const callbackError = { status: "error" as const, error: "AI 流式响应处理失败" };
    const handler = (_event: Electron.IpcRendererEvent, text: string) => {
      if (callbackFailed) return;
      try {
        onDelta(text);
      } catch {
        callbackFailed = true;
        ipcRenderer.removeListener(channel, handler);
        void ipcRenderer.invoke("aiModel:cancel", id).catch(() => {});
      }
    };
    ipcRenderer.removeAllListeners(channel);
    ipcRenderer.on(channel, handler);
    try {
      const result = await ipcRenderer.invoke("aiModel:stream", request);
      return callbackFailed ? callbackError : result;
    } catch (error) {
      if (callbackFailed) return callbackError;
      throw error;
    } finally {
      ipcRenderer.removeListener(channel, handler);
      streams.delete(id);
    }
  },
};
