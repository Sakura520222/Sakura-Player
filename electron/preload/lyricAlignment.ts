import { ipcRenderer } from "electron";
import type { LyricAlignmentApi } from "@shared/types/lyricAlignment";

export const lyricAlignmentApi: LyricAlignmentApi = {
  /**
   * 提交已有辅助歌词的有界本地对齐任务
   * @param request - 当前歌词快照与所选辅助轨道
   * @returns 本地对齐结果或取消及失败状态
   */
  align: (request) => ipcRenderer.invoke("lyricAlignment:align", request),
  /**
   * 取消本窗口拥有的任务
   * @param requestId - 当前任务标识
   * @returns 是否找到并取消了任务
   */
  cancel: (requestId) => ipcRenderer.invoke("lyricAlignment:cancel", requestId),
  /** 获取专用环境状态，不触发安装 */
  environmentStatus: () => ipcRenderer.invoke("lyricAlignment:environmentStatus"),
  /** 用户点击后安装完整的专用环境 */
  installEnvironment: () => ipcRenderer.invoke("lyricAlignment:installEnvironment"),
  /** 取消安装并由主进程回收文件及进程 */
  cancelEnvironmentInstall: () => ipcRenderer.invoke("lyricAlignment:cancelEnvironmentInstall"),
  /** 卸载专用环境和模型 */
  uninstallEnvironment: () => ipcRenderer.invoke("lyricAlignment:uninstallEnvironment"),
  /** 关闭窗口时由主进程确认是否需要继续后台安装 */
  continueInBackground: () => ipcRenderer.invoke("lyricAlignment:continueInBackground"),
  /**
   * 订阅环境状态，HMR 时移除旧监听器
   * @param callback - 状态变化处理
   * @returns 解除监听的操作
   */
  onEnvironmentStatus: (callback) => {
    const channel = "lyricAlignment:environment-status";
    ipcRenderer.removeAllListeners(channel);
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof callback>[0],
    ): void => callback(state);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};
