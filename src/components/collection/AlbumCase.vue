<script setup lang="ts">
import type { AlbumListeningStats } from "@shared/types/stats";
import { createAlbumCaseScene, type AlbumCaseScene } from "./albumCaseScene";
import {
  FRONT_POSE,
  resetPose,
  rotatePose,
  smoothProgress,
  type Quaternion,
} from "./albumCaseMath";

const props = defineProps<{
  cover?: string;
  thumbnail?: string;
  title: string;
  listening: AlbumListeningStats | null;
  active: boolean;
  reduceMotion?: boolean;
}>();
const { t, locale } = useI18n();
const preferredMotion = usePreferredReducedMotion();
const reducedMotion = computed(() => props.reduceMotion || preferredMotion.value === "reduce");
const visibility = useDocumentVisibility();
const stage = useTemplateRef<HTMLElement>("stage");
const canvas = useTemplateRef<HTMLCanvasElement>("canvas");
const scene = shallowRef<AlbumCaseScene>();
const failed = ref(false);
const opened = ref(false);
const dragging = ref(false);
let pose: Quaternion = [...FRONT_POSE];
let progress = 0;
let cameraProgress = 0;
let opening: { from: number; to: number; cameraFrom: number; started: number } | null = null;
let resetting: { from: Quaternion; started: number } | null = null;
let pointer: { id: number; x: number; y: number; time: number; moved: boolean } | null = null;
let velocityX = 0;
let velocityY = 0;
let frameTime = 0;
let frameId = 0;
let disposed = false;

const notes = computed(() => ({
  title: props.title,
  heading: t("collection.albumCase.listeningNotes"),
  countLabel: t("collection.albumCase.playCount"),
  count: props.listening ? String(props.listening.playCount) : "—",
  dateLabel: t("collection.albumCase.firstPlayed"),
  date: !props.listening
    ? "—"
    : props.listening.firstPlayedAt
      ? new Intl.DateTimeFormat(locale.value, {
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(props.listening.firstPlayedAt)
      : t("collection.albumCase.notPlayed"),
}));

/**
 * 更新开合、相机、惯性和最短路径复位，所有表面共享同一帧状态
 * @param now - 当前帧时间
 * @returns 是否仍需后续动画帧
 */
const updateMotion = (now: number): boolean => {
  if (opening) {
    const elapsed = now - opening.started;
    progress = opening.from + (opening.to - opening.from) * smoothProgress(elapsed / 550);
    const cameraTime = elapsed - (opening.to < opening.from ? 300 : 0);
    cameraProgress =
      opening.cameraFrom + (opening.to - opening.cameraFrom) * smoothProgress(cameraTime / 200);
    if (elapsed >= 550) opening = null;
  }
  if (resetting) {
    const elapsed = now - resetting.started;
    pose = resetPose(resetting.from, smoothProgress(elapsed / 700));
    if (elapsed >= 700) resetting = null;
  } else if (!pointer && (velocityX || velocityY)) {
    const delta = Math.min(32, Math.max(0, now - frameTime));
    const decay = Math.exp(-delta / 300);
    pose = rotatePose(pose, velocityX * 300 * (1 - decay), velocityY * 300 * (1 - decay));
    velocityX *= decay;
    velocityY *= decay;
    if (Math.hypot(velocityX, velocityY) < 0.004) velocityX = velocityY = 0;
  }
  frameTime = now;
  return !!(opening || resetting || (!pointer && (velocityX || velocityY)));
};

/**
 * 绘制活动帧，动画结束后停止调度
 * @param now - 浏览器帧时间
 */
const renderFrame = (now: number): void => {
  frameId = 0;
  if (!props.active || document.hidden || disposed) return;
  const moving = updateMotion(now);
  scene.value?.draw(pose, progress, cameraProgress);
  if (moving) requestRender();
};

/** 合并图片、尺寸和指针更新，最多保留一个待绘制帧 */
const requestRender = (): void => {
  if (!frameId && props.active && !document.hidden && !disposed)
    frameId = requestAnimationFrame(renderFrame);
};

/** 清除惯性与指针捕获，取消手势不会触发开合 */
const cancelDrag = (): void => {
  velocityX = velocityY = 0;
  const captured = pointer;
  pointer = null;
  dragging.value = false;
  if (captured && stage.value?.hasPointerCapture(captured.id))
    stage.value.releasePointerCapture(captured.id);
};

/** 恢复正面闭盒，使用四元数最短路径而非累计角度回放 */
const reset = (): void => {
  const now = performance.now();
  updateMotion(now);
  cancelDrag();
  opened.value = false;
  if (reducedMotion.value) {
    pose = [...FRONT_POSE];
    progress = cameraProgress = 0;
    opening = resetting = null;
  } else {
    resetting = { from: pose, started: now };
    opening = { from: progress, to: 0, cameraFrom: cameraProgress, started: now };
  }
  requestRender();
};

/** 点击开合，镜头先退后开盖，关闭时先合盖再推进 */
const toggle = (): void => {
  const now = performance.now();
  updateMotion(now);
  opened.value = !opened.value;
  const target = opened.value ? 1 : 0;
  if (reducedMotion.value) {
    progress = cameraProgress = target;
    opening = null;
  } else opening = { from: progress, to: target, cameraFrom: cameraProgress, started: now };
  requestRender();
};

/**
 * 捕获左键旋转，中键恢复初始姿态
 * @param event - 指针按下事件
 */
const onPointerDown = (event: PointerEvent): void => {
  if (!props.active) return;
  if (event.button === 1) {
    event.preventDefault();
    reset();
    return;
  }
  if (event.button !== 0 || pointer) return;
  event.preventDefault();
  updateMotion(performance.now());
  velocityX = velocityY = 0;
  resetting = null;
  pointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
    moved: false,
  };
  stage.value?.setPointerCapture(event.pointerId);
};

/**
 * 拖拽更新单位四元数，避免多圈操作累积缩放误差
 * @param event - 指针移动事件
 */
const onPointerMove = (event: PointerEvent): void => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.x,
    dy = event.clientY - pointer.y;
  if (!pointer.moved && Math.hypot(dx, dy) < 4) return;
  pointer.moved = true;
  dragging.value = true;
  const now = performance.now(),
    elapsed = Math.max(8, now - pointer.time);
  velocityY = velocityY * 0.25 + Math.max(-1.2, Math.min(1.2, (dx * 0.6) / elapsed)) * 0.75;
  velocityX = velocityX * 0.25 + Math.max(-1.2, Math.min(1.2, (dy * 0.6) / elapsed)) * 0.75;
  pose = rotatePose(pose, dy * 0.6, dx * 0.6);
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.time = now;
  requestRender();
};

/**
 * 松手延续角速度，短点击只切换盒盖
 * @param event - 指针抬起事件
 */
const onPointerUp = (event: PointerEvent): void => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const clicked = !pointer.moved;
  const coasting =
    !clicked && performance.now() - pointer.time < 100 && !reducedMotion.value && !document.hidden;
  const vx = velocityX,
    vy = velocityY;
  cancelDrag();
  if (clicked) toggle();
  else if (coasting) {
    velocityX = vx;
    velocityY = vy;
    frameTime = performance.now();
    requestRender();
  }
};

/**
 * 支持键盘开合、旋转和复位
 * @param event - 键盘事件
 */
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    cancelDrag();
    toggle();
  } else if (event.key === "Home") {
    event.preventDefault();
    reset();
  } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    updateMotion(performance.now());
    cancelDrag();
    resetting = null;
    pose = rotatePose(
      pose,
      event.key === "ArrowUp" ? -15 : event.key === "ArrowDown" ? 15 : 0,
      event.key === "ArrowLeft" ? -15 : event.key === "ArrowRight" ? 15 : 0,
    );
    requestRender();
  }
};

watch([scene, () => props.cover, () => props.thumbnail], ([current, cover, thumbnail]) => {
  void current
    ?.setCover(cover, thumbnail)
    .catch((error) => console.warn("[album-case] 封面加载失败", error));
});
watch([scene, notes], ([current, value]) => current?.setNotes(value));
watch([() => props.active, visibility], ([active, visible]) => {
  if (active && visible === "visible") {
    requestRender();
    return;
  }
  cancelDrag();
  cancelAnimationFrame(frameId);
  frameId = 0;
  if (opening) {
    progress = cameraProgress = opening.to;
    opening = null;
  }
  if (resetting) {
    pose = [...FRONT_POSE];
    resetting = null;
  }
});

let observer: ResizeObserver | undefined;
onMounted(async () => {
  observer = new ResizeObserver(requestRender);
  observer.observe(canvas.value!);
  try {
    const current = await createAlbumCaseScene(canvas.value!, requestRender);
    if (disposed) {
      current.dispose();
      return;
    }
    scene.value = current;
    requestRender();
  } catch (error) {
    if (!disposed) failed.value = true;
    console.warn("[album-case] 场景创建失败", error);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  cancelDrag();
  cancelAnimationFrame(frameId);
  observer?.disconnect();
  scene.value?.dispose();
  scene.value = undefined;
});
defineExpose({ reset });
</script>

<template>
  <div
    ref="stage"
    class="album-case-stage"
    :class="{ dragging }"
    :data-open="opened"
    role="button"
    tabindex="0"
    :aria-label="t('collection.albumCase.interaction')"
    :aria-pressed="opened"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="cancelDrag"
    @lostpointercapture="pointer && cancelDrag()"
    @auxclick.middle.prevent
    @contextmenu.prevent
    @keydown="onKeydown"
  >
    <canvas ref="canvas" class="album-case-surface" aria-hidden="true" />
    <DetailCover
      v-if="failed"
      :src="cover"
      :fallback="thumbnail"
      :alt="title"
      class="case-fallback"
    />
  </div>
</template>

<style scoped>
.album-case-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  touch-action: none;
  user-select: none;
  cursor: grab;
  outline-offset: -6px;
}
.album-case-stage.dragging {
  cursor: grabbing;
}
.album-case-surface {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}
.case-fallback {
  position: absolute;
  width: min(60%, 360px);
  aspect-ratio: 1;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
</style>
