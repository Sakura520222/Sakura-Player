import { BrowserWindow, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import type {
  AiCompletionRequest,
  AiConnectionTestRequest,
  AiModelSaveInput,
  AiRequestResult,
} from "@shared/types/ai";
import { completeAi, testAiConnection } from "@main/services/ai";
import { requestIdSchema } from "@main/services/ai/validation";
import {
  listAiModels,
  removeAiModel,
  saveAiModel,
  setActiveAiModel,
} from "@main/services/ai/model";

const MAX_REQUESTS = 8;
const DELTA_INTERVAL_MS = 50;
const pending = new Map<string, AbortController>();

/** 同一窗口的请求 ID 不可复用；窗口销毁、主框架导航和崩溃均中断网络请求 */
const runRequest = async <T>(
  event: IpcMainInvokeEvent,
  requestId: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<AiRequestResult<T>> => {
  const sender = event.sender;
  if (!requestIdSchema.safeParse(requestId).success) {
    return { status: "error", error: "AI 请求 ID 无效" };
  }
  if (sender.isDestroyed() || event.senderFrame !== sender.mainFrame) {
    return { status: "error", error: "AI 请求来源无效" };
  }
  const key = `${sender.id}:${requestId}`;
  if (pending.has(key)) return { status: "error", error: "AI 请求 ID 已在使用中" };
  if (pending.size >= MAX_REQUESTS)
    return { status: "error", error: "AI 并发请求过多，请稍后重试" };
  const controller = new AbortController();
  pending.set(key, controller);
  const abort = () => controller.abort();
  const navigate = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean) => {
    if (isMainFrame && !isInPlace) abort();
  };
  sender.once("destroyed", abort);
  sender.once("render-process-gone", abort);
  sender.on("did-start-navigation", navigate);
  try {
    const data = await run(controller.signal);
    return controller.signal.aborted ? { status: "cancelled" } : { status: "completed", data };
  } catch (error) {
    if (controller.signal.aborted) return { status: "cancelled" };
    return { status: "error", error: error instanceof Error ? error.message : "AI 请求失败" };
  } finally {
    pending.delete(key);
    sender.removeListener("destroyed", abort);
    sender.removeListener("render-process-gone", abort);
    sender.removeListener("did-start-navigation", navigate);
  }
};

/** 注册模型配置、文本调用、流式生成及取消接口 */
export const registerAiModelIpc = (): void => {
  ipcMain.handle("aiModel:list", listAiModels);
  ipcMain.handle("aiModel:save", (_event, input: AiModelSaveInput) => saveAiModel(input));
  ipcMain.handle("aiModel:remove", (_event, id: string) => removeAiModel(id));
  ipcMain.handle("aiModel:setActive", (_event, id: string | null) => setActiveAiModel(id));
  ipcMain.handle("aiModel:test", (event, request: AiConnectionTestRequest) =>
    runRequest(event, request?.requestId, (signal) => testAiConnection(request.config, signal)),
  );
  ipcMain.handle("aiModel:complete", (event, request: AiCompletionRequest) =>
    runRequest(event, request?.requestId, (signal) => completeAi(request, signal)),
  );
  ipcMain.handle("aiModel:stream", (event, request: AiCompletionRequest) =>
    runRequest(event, request?.requestId, async (signal) => {
      const sender = event.sender;
      let buffered = "";
      // 合并短文本增量，隐藏窗口只保留有界待发文本，完整结果由请求返回。
      const flush = () => {
        if (signal.aborted || !buffered || sender.isDestroyed()) return;
        try {
          if (!BrowserWindow.fromWebContents(sender)?.isVisible()) return;
          sender.send(`aiModel:delta:${request.requestId}`, buffered);
          buffered = "";
        } catch {
          pending.get(`${sender.id}:${request.requestId}`)?.abort();
        }
      };
      const timer = setInterval(flush, DELTA_INTERVAL_MS);
      try {
        const result = await completeAi(request, signal, (text) => {
          buffered += text;
        });
        flush();
        return result;
      } finally {
        clearInterval(timer);
      }
    }),
  );
  ipcMain.handle("aiModel:cancel", (event, requestId: string) => {
    if (
      !requestIdSchema.safeParse(requestId).success ||
      event.senderFrame !== event.sender.mainFrame
    )
      return false;
    const controller = pending.get(`${event.sender.id}:${requestId}`);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  });
};
