export type Quaternion = [number, number, number, number];
export const FRONT_POSE: Quaternion = [0, 0, 0, 1];

/**
 * 合成两个旋转，右侧旋转先执行
 * @param a - 外层旋转
 * @param b - 内层旋转
 * @returns 单位四元数
 */
export const multiplyPose = (a: Quaternion, b: Quaternion): Quaternion => {
  const [x, y, z, w] = a;
  const [u, v, s, t] = b;
  const result: Quaternion = [
    w * u + x * t + y * s - z * v,
    w * v - x * s + y * t + z * u,
    w * s + x * v - y * u + z * t,
    w * t - x * u - y * v - z * s,
  ];
  const length = Math.hypot(...result);
  return result.map((value) => value / length) as Quaternion;
};

/**
 * 将水平和垂直角度增量作用于当前姿态
 * @param pose - 当前单位四元数
 * @param x - 垂直旋转角度
 * @param y - 水平旋转角度
 * @returns 新姿态
 */
export const rotatePose = (pose: Quaternion, x: number, y: number): Quaternion => {
  const pitch = (x * Math.PI) / 360;
  const yaw = (y * Math.PI) / 360;
  return multiplyPose(
    [Math.sin(pitch), 0, 0, Math.cos(pitch)],
    multiplyPose(pose, [0, Math.sin(yaw), 0, Math.cos(yaw)]),
  );
};

/**
 * 沿最短球面弧线回到正面，不保留累计圈数
 * @param pose - 复位开始时的姿态
 * @param progress - 从 0 到 1 的复位进度
 * @returns 插值姿态
 */
export const resetPose = (pose: Quaternion, progress: number): Quaternion => {
  const from = pose[3] < 0 ? (pose.map((value) => -value) as Quaternion) : pose;
  const angle = Math.acos(Math.min(1, from[3]));
  if (angle < 0.00001) return [...FRONT_POSE];
  const factor = Math.sin((1 - progress) * angle) / Math.sin(angle);
  return [
    from[0] * factor,
    from[1] * factor,
    from[2] * factor,
    from[3] * factor + Math.sin(progress * angle) / Math.sin(angle),
  ];
};

/**
 * 把单位四元数转换为列主序矩阵
 * @param pose - 旋转姿态
 * @returns WebGL 旋转矩阵
 */
export const poseMatrix = ([x, y, z, w]: Quaternion): Float32Array =>
  new Float32Array([
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ]);

/**
 * 相乘列主序变换矩阵
 * @param a - 外层矩阵
 * @param b - 内层矩阵
 * @returns 合成矩阵
 */
export const multiplyMatrix = (a: Float32Array, b: Float32Array): Float32Array => {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) result[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  return result;
};

/**
 * 创建平移矩阵
 * @param x - 水平位移
 * @param y - 垂直位移
 * @param z - 深度位移
 * @returns 平移矩阵
 */
export const translation = (x: number, y: number, z: number): Float32Array =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

/**
 * 创建绕竖直轴旋转的矩阵
 * @param angle - 角度
 * @returns 旋转矩阵
 */
export const rotationY = (angle: number): Float32Array => {
  const radians = (angle * Math.PI) / 180;
  const c = Math.cos(radians),
    s = Math.sin(radians);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
};

/**
 * 还原网格各部分的铰链与碟片变换
 * @param name - 网格部件名称
 * @param progress - 开合进度
 * @returns 部件局部矩阵
 */
export const partMatrix = (name: string, progress: number): Float32Array => {
  if (name === "CaseFront")
    return multiplyMatrix(
      multiplyMatrix(translation(-1.300358, 0, 0.627219), rotationY(35 - progress * 110)),
      translation(1.300358, 0, -0.627219),
    );
  if (name === "CD")
    return multiplyMatrix(
      multiplyMatrix(translation(-2.212475, 0, 1.2121661), rotationY(17.5)),
      translation(1.36772, 0, -0.675156),
    );
  return translation(0, 0, 0);
};

/**
 * 计算首尾速度为零的开合插值
 * @param progress - 任意进度值
 * @returns 限制在 0 到 1 的平滑进度
 */
export const smoothProgress = (progress: number): number => {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
};
