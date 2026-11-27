import type { Ref } from "vue";
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
  type AvatarMood,
  type AvatarPose,
  type AvatarReaction,
} from "./avatarMotion";

interface UseAvatarMotionOptions {
  target: Ref<HTMLElement | undefined>;
  mood: Readonly<Ref<AvatarMood>>;
  dragging: Readonly<Ref<boolean>>;
  reducedMotion: Readonly<Ref<boolean>>;
}

type IdleGesture = "ear-left" | "ear-right" | "glance" | "sway";

const IDLE_GESTURES: readonly IdleGesture[] = ["ear-left", "ear-right", "glance", "sway"];
const GLANCE_TARGETS = [
  { x: -1.8, y: -0.4 },
  { x: 1.9, y: -0.5 },
  { x: -1.4, y: -1.3 },
  { x: 1.5, y: -1.4 },
  { x: 0.7, y: 0.9 },
] as const;
const THINK_GAZES = [
  { x: 1.8, y: -1.7 },
  { x: -1.6, y: -1.5 },
  { x: 1.1, y: -1.9 },
  { x: -0.8, y: -1.4 },
] as const;
const POSE_VARS = [
  "--head-x",
  "--head-y",
  "--head-sx",
  "--head-sy",
  "--ear-l",
  "--ear-r",
  "--cup-y",
  "--face-x",
  "--face-y",
  "--gaze-x",
  "--gaze-y",
  "--groove",
] as const;

/**
 * 驱动陪伴角色的耦合弹簧、自然眨眼与非重复微动作；静息、隐藏或减少动态效果时自动停帧
 * @param options - 角色挂载节点、情绪、拖拽与减动效状态
 * @returns 供窗口层注入节拍、指针、拖拽与交互反馈的控制器
 */
export function useAvatarMotion(options: UseAvatarMotionOptions) {
  const detector = createBeatGrooveState();
  const physics = createAvatarPhysicsState();
  let rafId = 0;
  let lastFrameAt = 0;
  let blinkTimer: ReturnType<typeof setTimeout> | undefined;
  let blinkClearTimer: ReturnType<typeof setTimeout> | undefined;
  let gestureTimer: ReturnType<typeof setTimeout> | undefined;
  let gestureResetTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerGaze: { x: number; y: number } | null = null;
  let idleGaze: { x: number; y: number } | null = null;
  let idleSway = 0;
  let lastGesture: IdleGesture | null = null;
  let lastGlance: (typeof GLANCE_TARGETS)[number] | null = null;
  let lastThinkGaze: (typeof THINK_GAZES)[number] | null = null;
  let disposed = false;

  /** 判断当前窗口是否允许运行动态效果 */
  function isActive(): boolean {
    return !disposed && !document.hidden && !options.reducedMotion.value;
  }

  /**
   * 将物理姿态直接写入 DOM 自定义属性，避免 60fps 触发 Vue 响应式开销
   * @param pose - 本帧计算出的角色姿态
   */
  function paintPose(pose: AvatarPose): void {
    const el = options.target.value;
    if (!el) return;
    const style = el.style;
    style.setProperty("--head-x", `${pose.headX.toFixed(2)}px`);
    style.setProperty("--head-y", `${pose.headY.toFixed(2)}px`);
    style.setProperty("--head-sx", pose.headScaleX.toFixed(4));
    style.setProperty("--head-sy", pose.headScaleY.toFixed(4));
    style.setProperty("--ear-l", `${pose.earL.toFixed(2)}deg`);
    style.setProperty("--ear-r", `${pose.earR.toFixed(2)}deg`);
    style.setProperty("--cup-y", `${pose.cupY.toFixed(2)}px`);
    style.setProperty("--face-x", `${pose.faceX.toFixed(2)}px`);
    style.setProperty("--face-y", `${pose.faceY.toFixed(2)}px`);
    style.setProperty("--gaze-x", `${pose.gazeX.toFixed(2)}px`);
    style.setProperty("--gaze-y", `${pose.gazeY.toFixed(2)}px`);
    style.setProperty("--groove", pose.groove.toFixed(3));
  }

  /** 停止全部定时器与动画帧，并清空内联偏移属性 */
  function freeze(): void {
    cancelAnimationFrame(rafId);
    rafId = 0;
    lastFrameAt = 0;
    clearTimeout(blinkTimer);
    clearTimeout(blinkClearTimer);
    clearTimeout(gestureTimer);
    clearTimeout(gestureResetTimer);
    blinkTimer = blinkClearTimer = gestureTimer = gestureResetTimer = undefined;
    pointerGaze = null;
    idleGaze = null;
    idleSway = 0;
    Object.assign(detector, createBeatGrooveState());
    Object.assign(physics, createAvatarPhysicsState());
    const el = options.target.value;
    if (!el) return;
    delete el.dataset.blink;
    for (const name of POSE_VARS) el.style.removeProperty(name);
  }

  /**
   * 推进一帧弹簧物理并在全部归于静息后自动停帧
   * @param now - 当前动画帧时间戳（毫秒）
   */
  function tick(now: number): void {
    rafId = 0;
    if (!isActive()) return;
    const dt = lastFrameAt ? (now - lastFrameAt) / 1000 : 1 / 60;
    lastFrameAt = now;
    const pose = stepAvatarMotion(physics, detector, dt, {
      mood: options.mood.value,
      dragging: options.dragging.value,
      now,
      pointerGaze,
      idleGaze,
      idleSway,
    });
    paintPose(pose);
    if (!isAvatarAtRest(physics, detector)) {
      rafId = requestAnimationFrame(tick);
    } else {
      lastFrameAt = 0;
    }
  }

  /** 唤醒按需动画循环 */
  function wake(): void {
    if (!isActive() || rafId) return;
    lastFrameAt = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  /** 按非均匀间隔触发自然单眨或双眨 */
  function scheduleBlink(): void {
    clearTimeout(blinkTimer);
    if (!isActive()) return;
    blinkTimer = setTimeout(
      () => {
        if (!isActive()) return;
        const el = options.target.value;
        if (el && options.mood.value !== "happy" && !options.dragging.value) {
          const doubleBlink = Math.random() < 0.22;
          delete el.dataset.blink;
          // 强制重新触发同属性动画
          void el.offsetWidth;
          el.dataset.blink = doubleBlink ? "double" : "single";
          clearTimeout(blinkClearTimer);
          blinkClearTimer = setTimeout(
            () => {
              if (options.target.value) delete options.target.value.dataset.blink;
            },
            doubleBlink ? 430 : 190,
          );
        }
        scheduleBlink();
      },
      organicDelay(2600, 6400),
    );
  }

  /** 调度不连续重复的自发小动作（单耳轻抖、四处张望、左右轻摆） */
  function scheduleGesture(): void {
    clearTimeout(gestureTimer);
    if (!isActive()) return;
    const thinking = options.mood.value === "thinking";
    gestureTimer = setTimeout(
      () => {
        if (!isActive()) return;
        if (options.mood.value === "thinking") {
          lastThinkGaze = pickNonRepeating(THINK_GAZES, lastThinkGaze);
          idleGaze = lastThinkGaze;
          wake();
        } else if (!options.dragging.value) {
          const gesture = pickNonRepeating(IDLE_GESTURES, lastGesture);
          lastGesture = gesture;
          if (gesture === "ear-left") {
            applyEarTwitch(physics, "left");
            wake();
          } else if (gesture === "ear-right") {
            applyEarTwitch(physics, "right");
            wake();
          } else if (gesture === "glance" && !pointerGaze && options.mood.value === "listening") {
            lastGlance = pickNonRepeating(GLANCE_TARGETS, lastGlance);
            idleGaze = lastGlance;
            wake();
            clearTimeout(gestureResetTimer);
            gestureResetTimer = setTimeout(
              () => {
                idleGaze = null;
                wake();
              },
              organicDelay(1100, 2100),
            );
          } else if (gesture === "sway" && options.mood.value === "listening") {
            idleSway = (Math.random() < 0.5 ? -1 : 1) * (1.8 + Math.random() * 1.4);
            wake();
            clearTimeout(gestureResetTimer);
            gestureResetTimer = setTimeout(
              () => {
                idleSway = 0;
                wake();
              },
              organicDelay(1200, 2200),
            );
          }
        }
        scheduleGesture();
      },
      thinking ? organicDelay(1400, 2600) : organicDelay(4000, 9000),
    );
  }

  /** 根据可见性与减动效状态启停所有自发动作 */
  function syncLifecycle(): void {
    if (!isActive()) {
      freeze();
      return;
    }
    scheduleBlink();
    scheduleGesture();
    wake();
  }

  /**
   * 消费主进程推送的音频能量，更新自适应节拍和交替律动
   * @param level - 音频能量（0~1）
   */
  function pushBeat(level: number): void {
    if (!isActive() || options.dragging.value) return;
    applyBeatSample(detector, physics, level, performance.now());
    wake();
  }

  /**
   * 根据指针与角色中心的相对距离柔和调整视线与微微侧耳
   * @param clientX - 窗口内光标 X
   * @param clientY - 窗口内光标 Y
   */
  function trackPointer(clientX: number, clientY: number): void {
    if (!isActive()) return;
    const el = options.target.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > 220) {
      if (pointerGaze) {
        pointerGaze = null;
        wake();
      }
      return;
    }
    const falloff = 1 - Math.min(1, dist / 260) * 0.45;
    pointerGaze = {
      x: Math.max(-1, Math.min(1, dx / 90)) * falloff,
      y: Math.max(-1, Math.min(1, dy / 90)) * falloff,
    };
    wake();
  }

  /** 指针离开窗口时让视线柔和回正 */
  function clearPointer(): void {
    if (!pointerGaze) return;
    pointerGaze = null;
    wake();
  }

  /**
   * 注入拖拽位移产生的惯性摆动
   * @param dx - 本次采样水平位移
   * @param dy - 本次采样垂直位移
   */
  function nudgeDrag(dx: number, dy: number): void {
    if (!isActive()) return;
    applyDragImpulse(physics, dx, dy);
    wake();
  }

  /**
   * 触发情绪切换或触控点击的弹性反馈
   * @param reaction - 反馈类型
   */
  function react(reaction: AvatarReaction): void {
    if (!isActive()) return;
    applyAvatarReaction(physics, reaction);
    wake();
  }

  watch(options.mood, (next, prev) => {
    idleGaze = null;
    idleSway = 0;
    clearTimeout(gestureResetTimer);
    if (!isActive()) return;
    if (next === "happy" && prev !== "happy") react("happy");
    else if (next === "curious" && prev !== "curious") react("curious");
    else wake();
    scheduleGesture();
  });

  watch(options.dragging, (active, prev) => {
    if (!isActive()) return;
    if (!active && prev) react("drop");
    else wake();
  });

  watch(options.target, (el) => {
    if (el && isActive()) wake();
  });

  watch(options.reducedMotion, syncLifecycle);

  onMounted(() => {
    document.addEventListener("visibilitychange", syncLifecycle);
    syncLifecycle();
  });

  onBeforeUnmount(() => {
    disposed = true;
    document.removeEventListener("visibilitychange", syncLifecycle);
    freeze();
  });

  return { pushBeat, trackPointer, clearPointer, nudgeDrag, react };
}
