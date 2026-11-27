import type { Point, Rectangle } from "electron";
import {
  COMPANION_AVATAR_SIZE,
  type CompanionPlacement,
  type CompanionSurface,
} from "@shared/types/companion";

const SURFACE_SIZE = {
  chat: { width: 356, height: 480 },
  bubble: { width: 280, height: 184 },
};

/**
 * 在角色上下选取足够的空间，气泡尽量居中，贴边时把完整内容留在屏内
 * @param surface - 所需展示区域
 * @param avatar - 已约束到屏幕内的角色边界
 * @param workArea - 当前显示器工作区
 * @returns 原生窗口边界和渲染端所需的相对位置
 */
function placeSurface(surface: CompanionSurface, avatar: Rectangle, workArea: Rectangle) {
  const size = SURFACE_SIZE[surface];
  const right = workArea.x + workArea.width;
  const above = avatar.y - workArea.y;
  const below = workArea.y + workArea.height - avatar.y - avatar.height;
  const side = above >= size.height - avatar.height || above >= below ? "top" : "bottom";
  const width = Math.min(workArea.width, size.width);
  const height = Math.min(size.height, avatar.height + (side === "top" ? above : below));
  const endX = avatar.x + avatar.width - width;
  const centeredX = avatar.x + Math.round((avatar.width - width) / 2);
  let idealX = centeredX;
  let align: CompanionPlacement["align"] = "center";
  if (surface === "chat" && endX >= workArea.x) {
    idealX = endX;
    align = "end";
  } else if (surface === "chat" && avatar.x + width <= right) {
    idealX = avatar.x;
    align = "start";
  }
  const x = Math.max(workArea.x, Math.min(idealX, right - width));
  if (surface === "bubble" && x !== centeredX) align = x > centeredX ? "start" : "end";
  const y = side === "top" ? avatar.y + avatar.height - height : avatar.y;
  const bounds = { x, y, width, height };
  const layout: CompanionPlacement = {
    width,
    height,
    avatarX: avatar.x - x,
    avatarY: avatar.y - y,
    side,
    align,
  };
  return { bounds, layout };
}

/**
 * 在当前工作区内保留角色的屏幕落点，同时计算聊天和回复气泡的可用边界
 * @param anchor - 角色区域的屏幕坐标
 * @param workArea - 所在显示器的可用区域
 * @returns 收起、聊天和气泡三种窗口边界及对应的展开布局
 */
export function companionBounds(anchor: Point, workArea: Rectangle) {
  const width = Math.min(COMPANION_AVATAR_SIZE, workArea.width);
  const height = Math.min(COMPANION_AVATAR_SIZE, workArea.height);
  const closed = {
    x: Math.max(workArea.x, Math.min(anchor.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(anchor.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
  const chat = placeSurface("chat", closed, workArea);
  const bubble = placeSurface("bubble", closed, workArea);
  const frameX = Math.min(chat.bounds.x, bubble.bounds.x);
  const frameY = Math.min(chat.bounds.y, bubble.bounds.y);
  const frameRight = Math.max(
    chat.bounds.x + chat.bounds.width,
    bubble.bounds.x + bubble.bounds.width,
  );
  const frameBottom = Math.max(
    chat.bounds.y + chat.bounds.height,
    bubble.bounds.y + bubble.bounds.height,
  );
  const frame: Rectangle = {
    x: frameX,
    y: frameY,
    width: frameRight - frameX,
    height: frameBottom - frameY,
  };
  return {
    closed,
    open: chat.bounds,
    bubble: bubble.bounds,
    frame,
    layout: {
      ...chat.layout,
      bubble: bubble.layout,
      frame: {
        width: frame.width,
        height: frame.height,
        avatarX: closed.x - frame.x,
        avatarY: closed.y - frame.y,
      },
    },
  };
}
