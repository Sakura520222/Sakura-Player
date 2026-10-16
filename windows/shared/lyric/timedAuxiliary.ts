import type { LyricSpan } from "@shared/types/lyrics";
import "./timedAuxiliary.css";

export interface TimedAuxiliaryTarget {
  element: HTMLElement;
  words: LyricSpan[];
}

/**
 * 为引擎已创建的副行补充逐字遮罩，时间由原有播放循环推送，不创建额外 RAF
 */
export class TimedAuxiliaryRenderer {
  private readonly observer: MutationObserver;
  private mounted = new Map<HTMLElement, { words: LyricSpan[]; text: string }>();
  private time = -1;

  constructor(
    private readonly container: HTMLElement,
    private readonly targets: () => TimedAuxiliaryTarget[],
  ) {
    this.observer = new MutationObserver(() => this.refresh());
    this.refresh();
  }

  /** 引擎重建或虚拟化歌词 DOM 后重新绑定，旧节点立即释放 */
  refresh(): void {
    this.observer.disconnect();
    const next = new Map<HTMLElement, { words: LyricSpan[]; text: string }>();
    for (const { element, words } of this.targets()) {
      if (!words.length || !this.container.contains(element)) continue;
      const previous = this.mounted.get(element);
      if (previous?.words === words && element.querySelector("[data-aux-word]")) {
        next.set(element, previous);
        continue;
      }
      const text = element.textContent ?? "";
      if (
        text.replace(/\s+/g, " ").trim() !==
        words
          .map((word) => word.word)
          .join("")
          .replace(/\s+/g, " ")
          .trim()
      )
        continue;
      const fragment = document.createDocumentFragment();
      for (const word of words) {
        const span = document.createElement("span");
        span.dataset.auxWord = "";
        span.textContent = word.word;
        span.style.setProperty("--aux-start", String(word.startTime));
        span.style.setProperty(
          "--aux-duration",
          String(Math.max(1, word.endTime - word.startTime)),
        );
        fragment.appendChild(span);
      }
      element.replaceChildren(fragment);
      element.classList.add("timed-auxiliary");
      next.set(element, { words, text });
    }
    for (const [element, previous] of this.mounted) {
      if (next.has(element)) continue;
      if (element.classList.contains("timed-auxiliary")) {
        if (element.querySelector("[data-aux-word]")) element.textContent = previous.text;
        element.classList.remove("timed-auxiliary");
      }
    }
    this.mounted = next;
    if (next.size)
      this.container.style.setProperty("--lyric-aux-time", String(Math.max(0, this.time)));
    else this.container.style.removeProperty("--lyric-aux-time");
    this.observer.observe(this.container, { childList: true, subtree: true });
  }

  /** 复用主歌词的毫秒时间，暂停、跳转及隐藏恢复均由现有播放循环管理 */
  setCurrentTime(time: number): void {
    if (time === this.time) return;
    this.time = time;
    if (this.mounted.size) this.container.style.setProperty("--lyric-aux-time", String(time));
  }

  /** 解除 DOM 监听并释放当前歌曲节点引用 */
  dispose(): void {
    this.observer.disconnect();
    for (const [element, previous] of this.mounted) {
      if (element.querySelector("[data-aux-word]")) element.textContent = previous.text;
      element.classList.remove("timed-auxiliary");
    }
    this.mounted.clear();
    this.container.style.removeProperty("--lyric-aux-time");
  }
}
