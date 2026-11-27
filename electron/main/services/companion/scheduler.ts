import type { SongHighlightSegment } from "@shared/types/songHighlight";

const STABLE_MS = 6_000;
const COOLDOWN_MS = 30_000;

/**
 * 判断两条平台标注是否描述相交的播放区间
 * @param a - 第一条标注
 * @param b - 第二条标注
 * @returns 两个半开区间是否相交
 */
function overlaps(a: SongHighlightSegment, b: SongHighlightSegment): boolean {
  return a.startMs < (b.endMs ?? b.startMs + 3000) && b.startMs < (a.endMs ?? a.startMs + 3000);
}

/** 单曲播放期间保留已经触发的事件；暂停和拖动只重新计算稳定时间 */
export class CompanionScheduler {
  private stableSince: number | null = null;
  private nextAllowed = 0;
  private announced = false;
  private segments: readonly SongHighlightSegment[] = [];
  private seen = new Set<SongHighlightSegment>();

  /** 切换歌曲时允许介绍新曲，保留跨歌曲的发言冷却 */
  changeTrack(): void {
    this.announced = false;
    this.segments = [];
    this.seen.clear();
    this.interrupt();
  }

  /** 连续播放中断后重新等待稳定 */
  interrupt(): void {
    this.stableSince = null;
  }

  /**
   * 从连续播放的第一帧计时，让标注查询独立于对话和冷却状态
   * @param now - 当前时钟毫秒
   * @returns 当前歌曲是否已稳定播放
   */
  observePlaying(now: number): boolean {
    this.stableSince ??= now;
    return now - this.stableSince >= STABLE_MS;
  }

  /**
   * 替换当前歌曲的匹配结果，沿用仍然重叠的已发言区间
   * @param segments - 最新标注，等待匹配时传入空数组
   */
  setHighlights(segments: readonly SongHighlightSegment[]): void {
    this.segments = segments;
    if (segments.length) {
      const previous = [...this.seen];
      this.seen = new Set(
        segments.filter((segment) => previous.some((old) => overlaps(old, segment))),
      );
    }
  }

  /**
   * 给刚刚发言的用户留出继续聊天的时间
   * @param now - 当前时钟毫秒
   */
  defer(now: number): void {
    this.nextAllowed = now + COOLDOWN_MS;
  }

  /**
   * 稳定播放后挑选一个仍在发生的事件，相交标注合并为一次互动
   * @param now - 当前时钟毫秒
   * @param position - 曲目内毫秒位置
   * @param busy - 正在输入或已有对话请求
   * @returns 此次应发送给模型的音乐事件
   */
  takeEvent(
    now: number,
    position: number,
    busy: boolean,
  ): "track" | SongHighlightSegment["kind"] | undefined {
    if (busy || now < this.nextAllowed) return;
    const current = this.segments.filter(
      (segment) =>
        position >= segment.startMs && position < (segment.endMs ?? segment.startMs + 3_000),
    );
    const fresh = current.find((segment) => !this.seen.has(segment));
    if (!fresh && this.announced) return;
    this.announced = true;
    if (fresh) {
      // 不同平台可能错开数百毫秒标注同一段，首次发言时合并相交区间
      for (const segment of this.segments) {
        if (overlaps(fresh, segment)) this.seen.add(segment);
      }
    }
    this.defer(now);
    return fresh?.kind ?? "track";
  }
}
