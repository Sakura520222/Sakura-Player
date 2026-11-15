import { describe, expect, it } from "vitest";
import { FRONT_POSE, partMatrix, poseMatrix, resetPose, rotatePose } from "./albumCaseMath";

describe("专辑盒三维变换", () => {
  it("两个方向旋转多圈后仍沿最短弧线复位", () => {
    const pose = rotatePose(FRONT_POSE, -1125, 1125);
    let previous = 180;
    for (let i = 0; i <= 50; i++) {
      const current = resetPose(pose, i / 50);
      const angle = (2 * Math.acos(Math.min(1, Math.abs(current[3]))) * 180) / Math.PI;
      expect(angle).toBeLessThanOrEqual(previous + 0.00001);
      expect(angle).toBeLessThan(63);
      previous = angle;
    }
    expect(previous).toBeCloseTo(0);
  });
  it("持续拖拽不会累积缩放或剪切", () => {
    let pose = [...FRONT_POSE] as typeof FRONT_POSE;
    for (let i = 0; i < 3000; i++) pose = rotatePose(pose, 1.3, 2.7);
    const matrix = poseMatrix(pose);
    for (let column = 0; column < 3; column++)
      expect(Math.hypot(...matrix.slice(column * 4, column * 4 + 3))).toBeCloseTo(1, 6);
  });
  it("盒盖和碟片在任意开合进度下保持实际比例", () => {
    for (const name of ["CaseFront", "CD", "CaseBase"])
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const matrix = partMatrix(name, progress);
        for (let column = 0; column < 3; column++)
          expect(Math.hypot(...matrix.slice(column * 4, column * 4 + 3))).toBeCloseTo(1, 6);
      }
  });
});
