import type { WebContents } from "electron";
import { setFftEnabled } from "./engine";

/** 仅保留正在消费频谱的页面，窗口重载、崩溃或销毁时释放 */
const subscribers = new Map<WebContents, () => void>();

/** 当前是否有窗口需要频谱，用于音频引擎重建 */
export function hasFftSubscribers(): boolean {
  return subscribers.size > 0;
}

/**
 * 判断页面是否仍订阅频谱
 * @param sender - 窗口所属页面
 * @returns 页面是否请求推送
 */
export function isFftSubscriber(sender: WebContents): boolean {
  return subscribers.has(sender);
}

/**
 * 按页面管理频谱采集，避免一个窗口关闭另一个窗口所需的采集
 * @param sender - 请求窗口的页面
 * @param enabled - 是否订阅频谱
 */
export function subscribeFft(sender: WebContents, enabled: boolean): void {
  const existing = subscribers.get(sender);
  if (!enabled) {
    existing?.();
    return;
  }
  if (existing || sender.isDestroyed?.()) return;

  /** 释放页面持有的采集请求及其生命周期监听 */
  const release = () => {
    subscribers.delete(sender);
    sender.off("destroyed", release);
    sender.off("did-navigate", release);
    sender.off("render-process-gone", release);
    if (!subscribers.size) setFftEnabled(false);
  };
  if (!subscribers.size) setFftEnabled(true);
  subscribers.set(sender, release);
  sender.once("destroyed", release);
  // 同页路由和子帧加载都可能触发 did-start-loading，只有主文档被替换才释放
  sender.once("did-navigate", release);
  sender.once("render-process-gone", release);
}
