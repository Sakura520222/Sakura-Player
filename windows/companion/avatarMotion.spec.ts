import { describe, expect, it } from "vitest";
import {
  applyAvatarReaction,
  applyBeatSample,
  applyDragImpulse,
  applyEarTwitch,
  createAvatarPhysicsState,
  createBeatGrooveState,
  isAvatarAtRest,
  organicDelay,
  pickNonRepeating,
  stepAvatarMotion,
} from "./avatarMotion";

describe("陪伴角色有机动画物理引擎", () => {
  it("连续节拍冲击交替左右律动，避免单向机械点头", () => {
    const detector = createBeatGrooveState();
    const physics = createAvatarPhysicsState();
    // 先喂入低能量基线，再连续触发两次节拍冲击
    applyBeatSample(detector, physics, 0.05, 0, 0.5);
    expect(applyBeatSample(detector, physics, 0.72, 300, 0.4)).toBe(true);
    const firstDir = detector.swayDir;
    const firstTarget = detector.swayTarget;
    // 冷却期内重复高能量不会产生阶梯抖动
    expect(applyBeatSample(detector, physics, 0.75, 420, 0.4)).toBe(false);
    applyBeatSample(detector, physics, 0.1, 520, 0.4);
    expect(applyBeatSample(detector, physics, 0.78, 650, 0.4)).toBe(true);
    expect(detector.swayDir).toBe(-firstDir);
    expect(Math.sign(detector.swayTarget)).toBe(-Math.sign(firstTarget));
  });

  it("双耳与耳罩相对头部产生非对称滞后跟随，静息后自动休眠", () => {
    const detector = createBeatGrooveState();
    const physics = createAvatarPhysicsState();
    applyAvatarReaction(physics, "happy", 0.7);
    const pose1 = stepAvatarMotion(physics, detector, 1 / 60, {
      mood: "happy",
      dragging: false,
      now: 16,
      pointerGaze: null,
      idleGaze: null,
      idleSway: 0,
    });
    expect(pose1.headY).toBeLessThan(0);
    expect(pose1.headX).toBeGreaterThan(0);
    expect(pose1.earL).not.toBe(pose1.earR);
    expect(isAvatarAtRest(physics, detector)).toBe(false);

    // 推进足够多帧后，弹簧与视线应归于静息停帧
    let now = 32;
    for (let frame = 0; frame < 360; frame++) {
      now += 16;
      stepAvatarMotion(physics, detector, 1 / 60, {
        mood: "curious",
        dragging: false,
        now,
        pointerGaze: null,
        idleGaze: null,
        idleSway: 0,
      });
    }
    expect(isAvatarAtRest(physics, detector)).toBe(true);
  });

  it("拖拽惯性与单耳轻抖产生安全夹紧范围内的左右摆动且无倾斜", () => {
    const detector = createBeatGrooveState();
    const physics = createAvatarPhysicsState();
    // 纯水平拖拽时右耳因样式镜像应取相反局部符号，确保双耳同向滞后而非对称外张
    applyDragImpulse(physics, 80, 0);
    const horizontalDragPose = stepAvatarMotion(physics, detector, 1 / 60, {
      mood: "listening",
      dragging: true,
      now: 16,
      pointerGaze: null,
      idleGaze: null,
      idleSway: 0,
    });
    expect(horizontalDragPose.headX).toBeGreaterThan(0);
    expect(Math.abs(horizontalDragPose.headX)).toBeLessThanOrEqual(4.8);
    expect(horizontalDragPose.earL).toBeLessThan(0);
    expect(horizontalDragPose.earR).toBeGreaterThan(0);
    expect(horizontalDragPose.gazeY).toBeLessThan(0);

    // 连续高频拖拽与异常非有限位移不会导致弹簧速度无界堆积
    for (let i = 0; i < 60; i++) applyDragImpulse(physics, 120, -80);
    applyDragImpulse(physics, Number.NaN, Number.POSITIVE_INFINITY);
    expect(Math.abs(physics.headX.velocity)).toBeLessThanOrEqual(75);
    expect(Math.abs(physics.headY.velocity)).toBeLessThanOrEqual(75);
    expect(Math.abs(physics.earL.velocity)).toBeLessThanOrEqual(160);
    expect(Math.abs(physics.earR.velocity)).toBeLessThanOrEqual(160);

    const idlePhysics = createAvatarPhysicsState();
    applyEarTwitch(idlePhysics, "left", 0.5);
    const twitchPose = stepAvatarMotion(idlePhysics, detector, 1 / 60, {
      mood: "listening",
      dragging: false,
      now: 32,
      pointerGaze: null,
      idleGaze: null,
      idleSway: 0,
    });
    expect(Math.abs(twitchPose.earL)).toBeGreaterThan(Math.abs(twitchPose.earR));
  });

  it("非均匀间隔与非重复抽样不会连续重复同一种微动作", () => {
    expect(organicDelay(2000, 6000, 0, 0)).toBe(2000);
    expect(organicDelay(2000, 6000, 0.5, 0.5)).toBe(4000);
    expect(organicDelay(2000, 6000, 1, 1)).toBe(6000);

    const pool = ["ear-left", "ear-right", "glance", "sway"] as const;
    let prev: (typeof pool)[number] | null = null;
    for (let i = 0; i < 20; i++) {
      const next = pickNonRepeating(pool, prev, (i * 0.37) % 1);
      expect(next).not.toBe(prev);
      prev = next;
    }
  });
});
