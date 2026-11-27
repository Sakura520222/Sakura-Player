import { describe, expect, it } from "vitest";
import { CompanionScheduler } from "./scheduler";
import type { SongHighlightSegment } from "@shared/types/songHighlight";

const chorus: SongHighlightSegment = {
  startMs: 40_000,
  endMs: 48_000,
  kind: "chorus",
  platform: "netease",
  platformId: "n",
  confidence: "exact-id",
};

describe("听歌陪伴调度", () => {
  it("五赫兹播放、重叠标注与回拖均只触发一次", () => {
    const scheduler = new CompanionScheduler();
    const segments = [
      chorus,
      { ...chorus, startMs: 40_328, endMs: 49_000, kind: "climax" as const },
    ];
    const events: string[] = [];
    scheduler.setHighlights(segments);
    for (let ms = 0; ms < 100_000; ms += 200) {
      if (!scheduler.observePlaying(ms)) continue;
      const event = scheduler.takeEvent(ms, ms % 50_000, false);
      if (event) events.push(event);
    }
    expect(events).toEqual(["track", "chorus"]);
  });

  it("切歌、暂停和 seek 重新等待稳定，输入和冷却期抑制发言", () => {
    const scheduler = new CompanionScheduler();
    expect(scheduler.observePlaying(0)).toBe(false);
    scheduler.changeTrack();
    expect(scheduler.observePlaying(5_800)).toBe(false);
    scheduler.interrupt();
    expect(scheduler.observePlaying(11_800)).toBe(false);
    expect(scheduler.observePlaying(17_800)).toBe(true);
    expect(scheduler.takeEvent(17_800, 36_000, true)).toBeUndefined();
    scheduler.defer(18_000);
    scheduler.setHighlights([chorus]);
    expect(scheduler.takeEvent(47_999, 38_000, false)).toBeUndefined();
    expect(scheduler.takeEvent(48_000, 40_000, false)).toBe("chorus");
    scheduler.changeTrack();
    expect(scheduler.observePlaying(48_100)).toBe(false);
    expect(scheduler.observePlaying(55_000)).toBe(true);
    expect(scheduler.takeEvent(55_000, 6900, false)).toBeUndefined();
    expect(scheduler.takeEvent(79_000, 30_900, false)).toBe("track");
  });
});
