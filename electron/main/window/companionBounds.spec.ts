import { describe, expect, it } from "vitest";
import { companionBounds } from "./companionBounds";

const workArea = { x: -1280, y: 20, width: 1280, height: 700 };

describe("听歌陪伴窗口边界", () => {
  it.each([
    [{ x: -1280, y: 20 }, "bottom", "start"],
    [{ x: -80, y: 20 }, "bottom", "end"],
    [{ x: -1280, y: 640 }, "top", "start"],
    [{ x: -80, y: 640 }, "top", "end"],
    [{ x: -720, y: 320 }, "bottom", "end"],
  ] as const)("从角色 %j 展开时屏幕坐标保持不动", (anchor, side, align) => {
    const { closed, open, layout } = companionBounds(anchor, workArea);
    expect(closed).toEqual({ ...anchor, width: 80, height: 80 });
    expect([open.x + layout.avatarX, open.y + layout.avatarY]).toEqual([anchor.x, anchor.y]);
    expect(layout).toMatchObject({ side, align });
    expect(open.x).toBeGreaterThanOrEqual(workArea.x);
    expect(open.y).toBeGreaterThanOrEqual(workArea.y);
    expect(open.x + open.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(open.y + open.height).toBeLessThanOrEqual(workArea.y + workArea.height);
  });

  it("在负坐标屏和已拔除的屏幕之间保持角色可见", () => {
    expect(companionBounds({ x: -2240, y: -320 }, workArea).closed).toMatchObject({
      x: -1280,
      y: 20,
    });
    expect(companionBounds({ x: 5520, y: 3820 }, workArea).closed).toEqual({
      x: -80,
      y: 640,
      width: 80,
      height: 80,
    });
  });

  it("窄屏按可用侧缩短面板，角色居中的偏移仍对应实际锚点", () => {
    const small = { x: 10, y: 10, width: 340, height: 390 };
    const { open, layout } = companionBounds({ x: 150, y: 45 }, small);
    expect(open).toEqual({ x: 10, y: 45, width: 340, height: 355 });
    expect(layout).toMatchObject({
      width: 340,
      height: 355,
      avatarX: 140,
      avatarY: 0,
      side: "bottom",
      align: "center",
    });
  });
  it.each([
    [{ x: -640, y: 240 }, "top", "center"],
    [{ x: -1280, y: 20 }, "bottom", "start"],
    [{ x: -80, y: 20 }, "bottom", "end"],
    [{ x: -1280, y: 640 }, "top", "start"],
    [{ x: -80, y: 640 }, "top", "end"],
  ] as const)("回复气泡在 %j 维持角色落点并在屏边翻转", (anchor, side, align) => {
    const { closed, bubble, layout } = companionBounds(anchor, workArea);
    expect(layout.bubble).toMatchObject({ width: 280, height: 184, side, align });
    expect([bubble.x + layout.bubble.avatarX, bubble.y + layout.bubble.avatarY]).toEqual([
      closed.x,
      closed.y,
    ]);
    if (align === "center") expect(bubble.x + bubble.width / 2).toBe(closed.x + closed.width / 2);
    expect(bubble.x).toBeGreaterThanOrEqual(workArea.x);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(bubble.y).toBeGreaterThanOrEqual(workArea.y);
    expect(bubble.y + bubble.height).toBeLessThanOrEqual(workArea.y + workArea.height);
  });

  it("统一外框同时包住角色、聊天面板和回复气泡且保持角色屏幕坐标", () => {
    for (const anchor of [
      { x: -1280, y: 20 },
      { x: -80, y: 20 },
      { x: -640, y: 240 },
      { x: -640, y: 400 },
      { x: -80, y: 640 },
    ]) {
      const { closed, open, bubble, frame, layout } = companionBounds(anchor, workArea);
      expect(layout.frame).toEqual({
        width: frame.width,
        height: frame.height,
        avatarX: closed.x - frame.x,
        avatarY: closed.y - frame.y,
      });
      expect([frame.x + layout.frame!.avatarX, frame.y + layout.frame!.avatarY]).toEqual([
        closed.x,
        closed.y,
      ]);
      expect(frame.x).toBeLessThanOrEqual(Math.min(open.x, bubble.x));
      expect(frame.y).toBeLessThanOrEqual(Math.min(open.y, bubble.y));
      expect(frame.x + frame.width).toBeGreaterThanOrEqual(
        Math.max(open.x + open.width, bubble.x + bubble.width),
      );
      expect(frame.y + frame.height).toBeGreaterThanOrEqual(
        Math.max(open.y + open.height, bubble.y + bubble.height),
      );
      expect(frame.x).toBeGreaterThanOrEqual(workArea.x);
      expect(frame.y).toBeGreaterThanOrEqual(workArea.y);
      expect(frame.x + frame.width).toBeLessThanOrEqual(workArea.x + workArea.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(workArea.y + workArea.height);
    }
  });
});
