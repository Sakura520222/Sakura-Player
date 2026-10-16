import { describe, expect, it, vi } from "vitest";
import { applyLyricCjkTransform } from "./cjkTransform";
import { ALIGNMENT_LINES } from "@shared/testFixtures/lyricAlignment";

describe("逐字辅助歌词简繁转换", () => {
  it("同步转换文本与分段，保持全部时间戳并且不修改输入", async () => {
    const lines = structuredClone(ALIGNMENT_LINES);
    lines[0].translatedLyric = "身体";
    lines[0].translationWords = [
      { word: "身", startTime: 1100, endTime: 1600 },
      { word: "体", startTime: 2200, endTime: 4000 },
    ];
    const before = structuredClone(lines);
    const convertBatch = vi.fn(async (texts: string[]) =>
      texts.map((text) => text.replaceAll("体", "體")),
    );
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { opencc: { convertBatch } },
    });
    const transformed = await applyLyricCjkTransform(lines, "s2t");
    expect(transformed[0].translatedLyric).toBe("身體");
    expect(transformed[0].translationWords).toEqual([
      { word: "身", startTime: 1100, endTime: 1600 },
      { word: "體", startTime: 2200, endTime: 4000 },
    ]);
    expect(lines).toEqual(before);
    expect(convertBatch).toHaveBeenCalledOnce();
  });
});
