import { app, BrowserWindow, ipcMain } from "electron";
import { alignmentRequestSchema, runLocalAlignment } from "@main/services/lyricAlignment";
import type { LocalAlignmentResponse } from "@shared/types/lyricAlignment";
import {
  cancelAlignmentEnvironmentInstall,
  getAlignmentEnvironmentStatus,
  installAlignmentEnvironment,
  setAlignmentEnvironmentListener,
  uninstallAlignmentEnvironment,
  isAlignmentEnvironmentBusy,
} from "@main/services/lyricAlignment/environment";

/** 注册本地对齐任务，限制单任务内存并在窗口退出时回收工作进程 */
export const registerLyricAlignmentIpc = (): void => {
  let pending: { owner: number; id: string; controller: AbortController } | null = null;
  app.once("before-quit", () => {
    pending?.controller.abort();
    cancelAlignmentEnvironmentInstall();
  });
  let previousPhase = "";
  ipcMain.handle("lyricAlignment:continueInBackground", (event) => {
    if (event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return false;
    if (!isAlignmentEnvironmentBusy()) return false;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return false;
    window.hide();
    return true;
  });
  setAlignmentEnvironmentListener((state) => {
    const phaseChanged = state.phase !== previousPhase;
    previousPhase = state.phase;
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      try {
        if (phaseChanged || window.isVisible())
          window.webContents.send("lyricAlignment:environment-status", state);
      } catch {
        // 窗口崩溃或导航不影响安装，重建后会重新查询状态
      }
    }
  });
  for (const [channel, handler] of [
    ["environmentStatus", getAlignmentEnvironmentStatus],
    ["installEnvironment", installAlignmentEnvironment],
    ["cancelEnvironmentInstall", cancelAlignmentEnvironmentInstall],
    ["uninstallEnvironment", uninstallAlignmentEnvironment],
  ] as const) {
    ipcMain.handle(`lyricAlignment:${channel}`, (event) => {
      if (event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame)
        throw new Error("环境请求来源无效");
      return handler();
    });
  }
  ipcMain.handle(
    "lyricAlignment:align",
    async (event, input: unknown): Promise<LocalAlignmentResponse> => {
      const parsed = alignmentRequestSchema.safeParse(input);
      const sender = event.sender;
      if (!parsed.success || sender.isDestroyed() || event.senderFrame !== sender.mainFrame)
        return { status: "error", error: "对齐请求无效或歌词过长" };
      if (pending) return { status: "error", error: "已有对齐任务正在运行" };
      const controller = new AbortController();
      pending = { owner: sender.id, id: parsed.data.requestId, controller };
      const abort = () => controller.abort();
      const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
        if (mainFrame && !inPlace) abort();
      };
      sender.once("destroyed", abort);
      sender.once("render-process-gone", abort);
      sender.on("did-start-navigation", navigate);
      try {
        const result = await runLocalAlignment(parsed.data, controller.signal);
        return controller.signal.aborted
          ? { status: "cancelled" }
          : { status: "completed", ...result };
      } catch (error) {
        return controller.signal.aborted
          ? { status: "cancelled" }
          : { status: "error", error: error instanceof Error ? error.message : String(error) };
      } finally {
        pending = null;
        sender.removeListener("destroyed", abort);
        sender.removeListener("render-process-gone", abort);
        sender.removeListener("did-start-navigation", navigate);
      }
    },
  );
  ipcMain.handle("lyricAlignment:cancel", (event, requestId: unknown) => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      pending?.owner !== event.sender.id ||
      pending.id !== requestId
    )
      return false;
    pending.controller.abort();
    return true;
  });
};
