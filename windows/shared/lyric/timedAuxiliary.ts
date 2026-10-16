import type { LyricSpan } from "@shared/types/lyrics";
import { sequenceTranslationWords } from "@shared/utils/lyricTiming";
import "./timedAuxiliary.css";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface TimedAuxiliaryTarget {
  element: HTMLElement;
  words: LyricSpan[];
  kind?: "translation" | "romanization";
}
interface PaintState {
  element: HTMLElement;
  word: LyricSpan;
  progress: number;
}
interface WordState extends PaintState {
  glyphs?: PaintState[];
  glyphCursor: number;
  glyphTime: number;
}
interface MountedRow {
  source: LyricSpan[];
  kind: TimedAuxiliaryTarget["kind"];
  words: WordState[];
  text: string;
}

/** 复用已有播放循环，仅更新正在演唱的辅助字词，不把时间变量传播到整首歌词 */
export class TimedAuxiliaryRenderer {
  private readonly observer: MutationObserver;
  private mounted = new Map<HTMLElement, MountedRow>();
  private events: { time: number; ended: boolean; word: WordState }[] = [];
  private active = new Set<WordState>();
  private cursor = 0;
  private time = -1;

  constructor(
    private readonly container: HTMLElement,
    private readonly targets: () => TimedAuxiliaryTarget[],
  ) {
    this.observer = new MutationObserver((records) => {
      // 活动片段内部的字符展开不重扫整曲，仍处理同批次的引擎虚拟化变更。
      if (
        records.some(
          ({ target }) => !(target instanceof HTMLElement && target.hasAttribute("data-aux-word")),
        )
      )
        this.refresh();
    });
    this.refresh();
  }

  /** 引擎重建或虚拟化后仅重建变化的副行，索引仅保留当前歌曲的节点 */
  refresh(): void {
    this.observer.disconnect();
    const next = new Map<HTMLElement, MountedRow>();
    let changed = false;
    for (const { element, words: source, kind = "translation" } of this.targets()) {
      if (!source.length || !this.container.contains(element)) continue;
      const previous = this.mounted.get(element);
      if (
        previous?.source === source &&
        previous.kind === kind &&
        element.childNodes.length === previous.words.length &&
        element.firstChild === previous.words[0].element &&
        element.lastChild === previous.words.at(-1)!.element
      ) {
        next.set(element, previous);
        continue;
      }
      const text = element.textContent ?? "";
      if (
        text.replace(/\s+/g, " ").trim() !==
        source
          .map((word) => word.word)
          .join("")
          .replace(/\s+/g, " ")
          .trim()
      )
        continue;
      const words = kind === "translation" ? sequenceTranslationWords(source) : source;
      const fragment = document.createDocumentFragment();
      const states = words.map((word) => {
        const span = document.createElement("span");
        span.dataset.auxWord = "";
        span.textContent = word.word;
        fragment.appendChild(span);
        return { element: span, word, progress: -1, glyphCursor: 0, glyphTime: -Infinity };
      });
      element.replaceChildren(fragment);
      element.classList.add("timed-auxiliary");
      next.set(element, { source, kind, words: states, text });
      changed = true;
    }
    for (const [element, previous] of this.mounted) {
      if (next.has(element)) continue;
      changed = true;
      if (element.querySelector("[data-aux-word]")) element.textContent = previous.text;
      element.classList.remove("timed-auxiliary");
    }
    this.mounted = next;
    if (changed) {
      this.events = [];
      for (const row of next.values())
        for (const word of row.words) {
          this.events.push({ time: word.word.startTime, ended: false, word });
          this.events.push({ time: word.word.endTime, ended: true, word });
        }
      this.events.sort((a, b) => a.time - b.time || Number(b.ended) - Number(a.ended));
      this.seek(this.time);
    }
    this.observer.observe(this.container, { childList: true, subtree: true });
  }

  /** 只有当前活动字符写入遮罩进度，字符状态变化之外不产生样式写入 */
  private paint(state: PaintState, time: number, mask: boolean): number {
    const { startTime, endTime } = state.word;
    const progress =
      time >= endTime
        ? 1
        : time <= startTime
          ? 0
          : Math.round(((time - startTime) / (endTime - startTime)) * 10000) / 10000;
    if (state.progress === progress) return progress;
    const phase = progress === 1 ? "played" : progress === 0 ? "unplayed" : "active";
    if (state.element.dataset.auxState !== phase) state.element.dataset.auxState = phase;
    if (mask) {
      if (phase === "active") state.element.style.setProperty("--aux-progress", String(progress));
      else state.element.style.removeProperty("--aux-progress");
    }
    state.progress = progress;
    return progress;
  }

  /** 仅展开活动片段的字素，避免多行共用横向遮罩，也避免为整首歌创建字符节点 */
  private updateWord(state: WordState, time: number): void {
    const previous = state.progress;
    const progress = this.paint(state, time, false);
    if (progress === previous) return;
    if (progress === 0 || progress === 1) {
      if (state.glyphs) {
        state.element.textContent = state.word.word;
        state.glyphs = undefined;
        state.glyphCursor = 0;
        state.glyphTime = -Infinity;
      }
      return;
    }
    if (!state.glyphs) {
      const segments = Array.from(graphemes.segment(state.word.word));
      const fragment = document.createDocumentFragment();
      const duration = state.word.endTime - state.word.startTime;
      state.glyphs = [];
      for (const [index, { segment }] of segments.entries()) {
        if (!segment.trim()) {
          fragment.appendChild(document.createTextNode(segment));
          continue;
        }
        const element = document.createElement("span");
        element.dataset.auxGlyph = "";
        element.textContent = segment;
        fragment.appendChild(element);
        state.glyphs.push({
          element,
          word: {
            word: segment,
            startTime: state.word.startTime + (duration * index) / segments.length,
            endTime: state.word.startTime + (duration * (index + 1)) / segments.length,
          },
          progress: -1,
        });
      }
      state.element.replaceChildren(fragment);
    }
    const glyphs = state.glyphs;
    if (state.glyphTime === -Infinity || time < state.glyphTime) {
      for (const glyph of glyphs) this.paint(glyph, time, true);
      state.glyphCursor = 0;
    }
    while (state.glyphCursor < glyphs.length && glyphs[state.glyphCursor].word.endTime <= time) {
      this.paint(glyphs[state.glyphCursor++], time, true);
    }
    if (state.glyphCursor < glyphs.length) this.paint(glyphs[state.glyphCursor], time, true);
    state.glyphTime = time;
  }

  /** 跳转与副行重建时校准一次全部状态，正常播放只推进时间事件游标 */
  private seek(time: number): void {
    this.active.clear();
    for (const row of this.mounted.values())
      for (const word of row.words) {
        this.updateWord(word, time);
        if (word.word.startTime <= time && time < word.word.endTime) this.active.add(word);
      }
    let low = 0,
      high = this.events.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.events[middle].time <= time) low = middle + 1;
      else high = middle;
    }
    this.cursor = low;
  }

  /** 复用主歌词时间，不增加 RAF；每帧开销只与当前活动字词有关 */
  setCurrentTime(time: number): void {
    if (time === this.time) return;
    const backwards = time < this.time;
    this.time = time;
    if (backwards) {
      this.seek(time);
      return;
    }
    while (this.cursor < this.events.length && this.events[this.cursor].time <= time) {
      const event = this.events[this.cursor++];
      if (event.ended) {
        this.active.delete(event.word);
        this.updateWord(event.word, time);
      } else if (time < event.word.word.endTime) this.active.add(event.word);
      else this.updateWord(event.word, time);
    }
    for (const word of this.active) this.updateWord(word, time);
  }

  /** 解除监听，释放索引与节点，并恢复原副行文本 */
  dispose(): void {
    this.observer.disconnect();
    for (const [element, previous] of this.mounted) {
      if (element.querySelector("[data-aux-word]")) element.textContent = previous.text;
      element.classList.remove("timed-auxiliary");
    }
    this.mounted.clear();
    this.events = [];
    this.active.clear();
    this.cursor = 0;
  }
}
