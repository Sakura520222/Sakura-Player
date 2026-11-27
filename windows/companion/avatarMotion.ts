/** 陪伴角色的情绪状态 */
export type AvatarMood = "listening" | "thinking" | "happy" | "curious";

/** 可触发的一次性互动或情绪反馈 */
export type AvatarReaction = "hover" | "press" | "click" | "drop" | "happy" | "curious" | "message";

/** 单个有阻尼弹簧的状态 */
interface SpringState {
  value: number;
  velocity: number;
}

/** 音频节拍与律动相位跟踪器 */
export interface BeatGrooveState {
  baseline: number;
  peak: number;
  lastOnsetAt: number;
  lastBeatAt: number;
  beatCount: number;
  swayDir: 1 | -1;
  swayTarget: number;
  energy: number;
}

/** 多关节耦合弹簧与视线状态 */
export interface AvatarPhysicsState {
  headY: SpringState;
  headX: SpringState;
  squash: SpringState;
  earL: SpringState;
  earR: SpringState;
  cupY: SpringState;
  gazeX: number;
  gazeY: number;
  faceX: number;
  faceY: number;
  groove: number;
  targetY: number;
  targetX: number;
  targetSquash: number;
  targetEarL: number;
  targetEarR: number;
  targetGazeX: number;
  targetGazeY: number;
  targetFaceX: number;
  targetFaceY: number;
}

/** 单帧推进所需的外部输入 */
export interface AvatarStepInput {
  mood: AvatarMood;
  dragging: boolean;
  now: number;
  pointerGaze: { x: number; y: number } | null;
  idleGaze: { x: number; y: number } | null;
  idleSway: number;
}

/** 写入角色根节点的合成层偏移量 */
export interface AvatarPose {
  headX: number;
  headY: number;
  headScaleX: number;
  headScaleY: number;
  earL: number;
  earR: number;
  cupY: number;
  faceX: number;
  faceY: number;
  gazeX: number;
  gazeY: number;
  groove: number;
}

const ONSET_COOLDOWN_MS = 230;
const QUIET_HOLD_MS = 380;
const REST_EPSILON = 0.0025;

/**
 * 将数值约束到指定闭区间
 * @param value - 输入数值
 * @param min - 下界
 * @param max - 上界
 * @returns 夹紧后的数值
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 半隐式欧拉推进单自由度弹簧，避免高延迟帧发散
 * @param spring - 弹簧当前位置与速度
 * @param target - 目标位置
 * @param stiffness - 弹性系数
 * @param damping - 阻尼系数
 * @param dt - 帧时间步长（秒）
 */
function stepSpring(
  spring: SpringState,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): void {
  const force = (target - spring.value) * stiffness - spring.velocity * damping;
  spring.velocity += force * dt;
  spring.value += spring.velocity * dt;
}

/** 创建初始节拍律动检测状态 */
export function createBeatGrooveState(): BeatGrooveState {
  return {
    baseline: 0,
    peak: 0.16,
    lastOnsetAt: -Infinity,
    lastBeatAt: -Infinity,
    beatCount: 0,
    swayDir: 1,
    swayTarget: 0,
    energy: 0,
  };
}

/** 创建静止的多关节角色物理状态 */
export function createAvatarPhysicsState(): AvatarPhysicsState {
  return {
    headY: { value: 0, velocity: 0 },
    headX: { value: 0, velocity: 0 },
    squash: { value: 0, velocity: 0 },
    earL: { value: 0, velocity: 0 },
    earR: { value: 0, velocity: 0 },
    cupY: { value: 0, velocity: 0 },
    gazeX: 0,
    gazeY: 0,
    faceX: 0,
    faceY: 0,
    groove: 0,
    targetY: 0,
    targetX: 0,
    targetSquash: 0,
    targetEarL: 0,
    targetEarR: 0,
    targetGazeX: 0,
    targetGazeY: 0,
    targetFaceX: 0,
    targetFaceY: 0,
  };
}

/**
 * 将离散音频能量转化为自适应强度的律动脉冲与交替左右摆动，避免机械单向抖动
 * @param detector - 节拍与基线状态
 * @param physics - 角色多关节物理状态
 * @param rawLevel - 主进程推送的音频能量（0~1）
 * @param now - 当前时间戳（毫秒）
 * @param jitter - 0~1 的随机因子，用于微调相邻节拍的幅度与摆幅
 * @returns 本次采样是否触发了新的节拍冲击
 */
export function applyBeatSample(
  detector: BeatGrooveState,
  physics: AvatarPhysicsState,
  rawLevel: number,
  now: number,
  jitter = Math.random(),
): boolean {
  const level = clamp(Number.isFinite(rawLevel) ? rawLevel : 0, 0, 1);
  detector.lastBeatAt = now;
  const alpha = level > detector.baseline ? 0.24 : 0.08;
  detector.baseline =
    detector.baseline === 0 ? level * 0.6 : detector.baseline + (level - detector.baseline) * alpha;
  detector.peak = Math.max(0.14, level, detector.peak * 0.965);

  const normalized = clamp(level / detector.peak, 0, 1);
  detector.energy = detector.energy * 0.55 + normalized * 0.45;
  const transient = level - detector.baseline * 1.1;

  if (transient > 0.045 && level > 0.06 && now - detector.lastOnsetAt >= ONSET_COOLDOWN_MS) {
    detector.lastOnsetAt = now;
    detector.beatCount++;
    // 以四拍微弱重音和交替方向模拟自然左右律动，偶尔在极轻拍上保留同侧过渡
    const softHold = normalized < 0.32 && jitter > 0.78;
    if (!softHold) detector.swayDir = detector.swayDir === 1 ? -1 : 1;
    const accent = detector.beatCount % 4 === 1 ? 1.16 : 0.92 + jitter * 0.18;
    const punch = clamp((0.36 + normalized * 0.64) * accent, 0.28, 1.15);

    detector.swayTarget = detector.swayDir * (1.7 + punch * 1.8) * (0.88 + jitter * 0.24);
    // 先微压后弹起的律动速度，配合水平摆动与体积守恒的挤压拉伸
    physics.headY.velocity -= 34 * punch;
    physics.headX.velocity += detector.swayDir * (14 + 13 * punch);
    physics.squash.velocity += 0.28 * punch;
    physics.earL.velocity += (-28 - 18 * jitter) * punch;
    physics.earR.velocity += (-24 - 20 * (1 - jitter)) * punch;
    physics.cupY.velocity -= 18 * punch;
    return true;
  }

  if (level < 0.025) {
    detector.swayTarget *= 0.7;
    detector.energy *= 0.6;
  }
  return false;
}

/**
 * 注入交互或情绪变化带来的瞬时物理冲量
 * @param physics - 角色物理状态
 * @param reaction - 触发的事件类型
 * @param jitter - 0~1 的随机因子，用于区分相邻互动的细微方向变化
 */
export function applyAvatarReaction(
  physics: AvatarPhysicsState,
  reaction: AvatarReaction,
  jitter = Math.random(),
): void {
  const sign = jitter >= 0.5 ? 1 : -1;
  switch (reaction) {
    case "hover":
      physics.headY.velocity -= 24;
      physics.headX.velocity += sign * 7;
      physics.earL.velocity -= 38;
      physics.earR.velocity -= 34;
      break;
    case "press":
      physics.headY.velocity += 22;
      physics.squash.velocity += 0.38;
      physics.earL.velocity += 24;
      physics.earR.velocity += 24;
      break;
    case "click":
      physics.headY.velocity -= 44;
      physics.headX.velocity += sign * 10;
      physics.squash.velocity -= 0.34;
      physics.earL.velocity -= 52;
      physics.earR.velocity -= 46;
      physics.cupY.velocity -= 20;
      break;
    case "drop":
      physics.headY.velocity += 28;
      physics.squash.velocity += 0.42;
      physics.earL.velocity += 44;
      physics.earR.velocity += 38;
      physics.cupY.velocity += 18;
      break;
    case "happy":
      physics.headY.velocity -= 62;
      physics.headX.velocity += sign * 14;
      physics.squash.velocity -= 0.42;
      physics.earL.velocity -= 64;
      physics.earR.velocity -= 58;
      physics.cupY.velocity -= 26;
      break;
    case "curious":
      physics.headY.velocity -= 22;
      physics.headX.velocity += 14;
      physics.earR.velocity -= 58;
      physics.earL.velocity += 18;
      break;
    case "message":
      physics.headY.velocity -= 30;
      physics.headX.velocity += sign * 6;
      physics.earL.velocity -= 36;
      physics.earR.velocity -= 42;
      break;
  }
}

/**
 * 按拖拽时的指针位移注入惯性摆动，让角色随手势柔和左右回弹
 * @param physics - 角色物理状态
 * @param dx - 水平位移（像素）
 * @param dy - 垂直位移（像素）
 */
export function applyDragImpulse(physics: AvatarPhysicsState, dx: number, dy: number): void {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const sway = clamp(dx * 1.15, -24, 24);
  const lift = clamp(dy * 1.4, -26, 26);
  physics.headX.velocity = clamp(physics.headX.velocity + sway, -75, 75);
  physics.headY.velocity = clamp(physics.headY.velocity + lift, -75, 75);
  // 右耳在样式层做了水平镜像，左右摆动需要相反符号才能与左耳同向滞后
  physics.earL.velocity = clamp(physics.earL.velocity - sway * 1.4 + lift * 0.6, -160, 160);
  physics.earR.velocity = clamp(physics.earR.velocity + sway * 1.25 + lift * 0.52, -160, 160);
}

/**
 * 触发单只耳朵的轻巧抖动，避免双耳始终对称运动
 * @param physics - 角色物理状态
 * @param side - 要轻抖的耳朵侧
 * @param jitter - 0~1 的随机幅度因子
 */
export function applyEarTwitch(
  physics: AvatarPhysicsState,
  side: "left" | "right",
  jitter = Math.random(),
): void {
  const strength = 68 + jitter * 28;
  if (side === "left") {
    physics.earL.velocity -= strength;
    physics.headX.velocity -= 4.5;
  } else {
    physics.earR.velocity -= strength;
    physics.headX.velocity += 4.5;
  }
}

/**
 * 推进一帧多关节耦合弹簧并输出用于 GPU 合成的姿态参数
 * @param physics - 角色物理状态
 * @param detector - 节拍检测状态
 * @param dtSeconds - 距上一帧的秒数
 * @param input - 当前情绪、拖拽、指针与自发姿态输入
 * @returns 已夹紧到安全展示范围内的角色姿态
 */
export function stepAvatarMotion(
  physics: AvatarPhysicsState,
  detector: BeatGrooveState,
  dtSeconds: number,
  input: AvatarStepInput,
): AvatarPose {
  const dt = clamp(dtSeconds, 0.001, 0.05);
  const quiet = input.now - detector.lastBeatAt > QUIET_HOLD_MS || input.dragging;
  if (quiet) {
    const decay = Math.exp(-dt * 5.2);
    detector.energy *= decay;
    detector.swayTarget *= decay;
    if (detector.energy < 0.004) detector.energy = 0;
    if (Math.abs(detector.swayTarget) < 0.01) detector.swayTarget = 0;
  }

  const moodY = input.mood === "happy" ? -1.4 : input.mood === "thinking" ? -0.6 : 0;
  const pointerSway = input.pointerGaze ? input.pointerGaze.x * 1.4 : 0;
  const idleSway =
    !input.dragging && input.mood === "listening" && detector.energy < 0.08 ? input.idleSway : 0;

  physics.targetY = input.dragging ? 0.5 : moodY - detector.energy * 2.4;
  physics.targetX = input.dragging
    ? 0
    : clamp(
        detector.swayTarget * (input.mood === "curious" ? 0.6 : 1) + pointerSway + idleSway,
        -4.8,
        4.8,
      );
  physics.targetSquash = input.dragging ? 0.025 : 0;

  const prevHeadVy = physics.headY.velocity;
  const prevHeadVx = physics.headX.velocity;

  stepSpring(physics.headY, physics.targetY, 185, 14.5, dt);
  stepSpring(physics.headX, physics.targetX, 115, 12.0, dt);
  stepSpring(physics.squash, physics.targetSquash, 220, 15.5, dt);

  // 头部加速度反向耦合到双耳和耳罩，产生 50~90ms 的滞后跟随与非对称回弹
  const headAy = (physics.headY.velocity - prevHeadVy) / dt;
  const headAx = (physics.headX.velocity - prevHeadVx) / dt;
  const earTargetL = clamp(
    -physics.headY.velocity * 0.16 -
      headAy * 0.0045 -
      physics.headX.value * 0.9 -
      headAx * 0.007 +
      (input.mood === "curious" ? 4 : 0),
    -14,
    14,
  );
  const earTargetR = clamp(
    -physics.headY.velocity * 0.18 -
      headAy * 0.0052 +
      physics.headX.value * 0.98 +
      headAx * 0.0078 +
      (input.mood === "curious" ? -7 : 0),
    -14,
    14,
  );
  physics.targetEarL = earTargetL;
  physics.targetEarR = earTargetR;
  stepSpring(physics.earL, earTargetL, 132, 10.2, dt);
  stepSpring(physics.earR, earTargetR, 150, 11.4, dt);
  stepSpring(physics.cupY, clamp(-physics.headY.velocity * 0.035, -2, 2), 165, 12.5, dt);

  // 视线优先级：拖拽略微向上看 -> 指针跟随 -> 思考/空闲自发张望 -> 居中回正
  let desiredGazeX = 0;
  let desiredGazeY = 0;
  if (input.dragging) {
    desiredGazeX = clamp(physics.headX.value * 0.35, -2, 2);
    desiredGazeY = -1.1;
  } else if (input.pointerGaze) {
    desiredGazeX = input.pointerGaze.x * 2.3;
    desiredGazeY = input.pointerGaze.y * 1.4;
  } else if (input.idleGaze) {
    desiredGazeX = input.idleGaze.x;
    desiredGazeY = input.idleGaze.y;
  } else if (input.mood === "thinking") {
    desiredGazeX = 1.6;
    desiredGazeY = -1.6;
  }
  physics.targetGazeX = desiredGazeX;
  physics.targetGazeY = desiredGazeY;

  const gazeLerp = 1 - Math.exp(-dt * 11);
  physics.gazeX += (desiredGazeX - physics.gazeX) * gazeLerp;
  physics.gazeY += (desiredGazeY - physics.gazeY) * gazeLerp;

  const desiredFaceX = clamp(physics.headX.value * 0.32 + physics.gazeX * 0.35, -2.6, 2.6);
  const desiredFaceY = clamp(physics.headY.value * 0.18 + physics.gazeY * 0.3, -1.6, 1.6);
  physics.targetFaceX = desiredFaceX;
  physics.targetFaceY = desiredFaceY;
  physics.faceX += (desiredFaceX - physics.faceX) * gazeLerp;
  physics.faceY += (desiredFaceY - physics.faceY) * gazeLerp;
  physics.groove += (detector.energy - physics.groove) * (1 - Math.exp(-dt * 10));

  const squash = clamp(physics.squash.value, -0.052, 0.052);
  return {
    headX: clamp(physics.headX.value, -4.8, 4.8),
    headY: clamp(physics.headY.value, -6.2, 4.2),
    headScaleX: 1 + squash,
    headScaleY: 1 - squash * 0.92,
    earL: clamp(physics.earL.value, -14, 14),
    earR: clamp(physics.earR.value, -14, 14),
    cupY: clamp(physics.cupY.value, -2.2, 2.2),
    faceX: physics.faceX,
    faceY: physics.faceY,
    gazeX: physics.gazeX,
    gazeY: physics.gazeY,
    groove: clamp(physics.groove, 0, 1),
  };
}

/**
 * 判断所有弹簧与视线是否已完全归于静息，用于自动休眠 RAF 节省电量与 CPU
 * @param physics - 角色物理状态
 * @param detector - 节拍检测状态
 * @returns 是否可以安全停止动画帧循环
 */
export function isAvatarAtRest(physics: AvatarPhysicsState, detector: BeatGrooveState): boolean {
  if (detector.energy > REST_EPSILON || Math.abs(detector.swayTarget) > REST_EPSILON) return false;
  const springs: [SpringState, number][] = [
    [physics.headY, physics.targetY],
    [physics.headX, physics.targetX],
    [physics.squash, physics.targetSquash],
    [physics.earL, physics.targetEarL],
    [physics.earR, physics.targetEarR],
    [physics.cupY, 0],
  ];
  for (const [spring, target] of springs) {
    if (
      Math.abs(spring.value - target) > REST_EPSILON ||
      Math.abs(spring.velocity) > REST_EPSILON
    ) {
      return false;
    }
  }
  return (
    Math.abs(physics.gazeX - physics.targetGazeX) <= REST_EPSILON &&
    Math.abs(physics.gazeY - physics.targetGazeY) <= REST_EPSILON &&
    Math.abs(physics.faceX - physics.targetFaceX) <= REST_EPSILON &&
    Math.abs(physics.faceY - physics.targetFaceY) <= REST_EPSILON &&
    physics.groove <= REST_EPSILON
  );
}

/**
 * 生成偏向区间中部的非均匀随机间隔，消除固定周期定时器的机械感
 * @param minMs - 最小间隔（毫秒）
 * @param maxMs - 最大间隔（毫秒）
 * @param r1 - 第一个 0~1 随机值
 * @param r2 - 第二个 0~1 随机值
 * @returns 钟形分布的毫秒间隔
 */
export function organicDelay(
  minMs: number,
  maxMs: number,
  r1 = Math.random(),
  r2 = Math.random(),
): number {
  return Math.round(minMs + ((r1 + r2) / 2) * (maxMs - minMs));
}

/**
 * 从候选池中选择与上一次不同的微动作，防止连续重复同一种表现
 * @param pool - 候选动作列表
 * @param previous - 上一次执行的动作
 * @param random - 0~1 随机值
 * @returns 下一次应执行的微动作
 */
export function pickNonRepeating<T>(
  pool: readonly T[],
  previous: T | null,
  random = Math.random(),
): T {
  const candidates =
    pool.length > 1 && previous !== null ? pool.filter((item) => item !== previous) : pool;
  const index = Math.min(
    candidates.length - 1,
    Math.floor(clamp(random, 0, 0.999999) * candidates.length),
  );
  return candidates[index];
}
