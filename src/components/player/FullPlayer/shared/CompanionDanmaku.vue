<script setup lang="ts">
import type { CompanionMessage } from "@shared/types/companion";
import { defaultSystemConfig } from "@shared/defaults/settings";
import type { VNode } from "vue";

const props = defineProps<{ lanes: number; seconds: number; reducedMotion: boolean }>();
const entries = shallowRef<{ id: string; text: string; lane: number }[]>([]);
const duration = computed(() =>
  Number.isFinite(props.seconds)
    ? Math.min(18, Math.max(5, props.seconds))
    : defaultSystemConfig.companion.danmakuSeconds,
);
const overlay = ref<HTMLElement>();
const animations = new Map<string, Animation>();
let staticTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 停止并移除指定弹幕的合成层动画
 * @param id - 弹幕消息 ID
 */
function cancelAnimation(id: string): void {
  const animation = animations.get(id);
  if (!animation) return;
  animations.delete(id);
  animation.cancel();
}

/** 停止全部运行中的弹幕动画 */
function clearAnimations(): void {
  for (const animation of animations.values()) animation.cancel();
  animations.clear();
}

/**
 * 挂载后按实际像素宽度启动纯位移合成动画，避免混合单位回退主线程导致掉帧
 * @param vnode - 已挂载的弹幕文本节点
 * @param id - 弹幕消息 ID
 */
function startScroll(vnode: VNode, id: string): void {
  if (props.reducedMotion) return;
  const element = vnode.el as HTMLElement;
  const containerWidth = overlay.value?.clientWidth || window.innerWidth || 1280;
  const textWidth = element.offsetWidth;
  const factor = Math.max(1, (1 + textWidth / containerWidth) / 2);
  const durationMs = Math.round(duration.value * factor * 1000);
  if (typeof element.animate === "function") {
    cancelAnimation(id);
    const animation = element.animate(
      [
        { transform: `translate3d(${containerWidth}px, 0, 0)` },
        { transform: `translate3d(${-textWidth}px, 0, 0)` },
      ],
      { duration: durationMs, easing: "linear", fill: "forwards" },
    );
    animations.set(id, animation);
    void animation.finished.then(
      () => {
        if (animations.get(id) === animation) {
          animations.delete(id);
          finish(id);
        }
      },
      () => {},
    );
    return;
  }
  element.style.setProperty("--danmaku-from", `${containerWidth}px`);
  element.style.setProperty("--danmaku-to", `${-textWidth}px`);
  element.style.setProperty("--danmaku-duration", `${durationMs}ms`);
  element.classList.add("fallback-scroll");
}

/** 静态弹幕每次显示一整行，到末行后再释放轨道 */
function advanceStaticLine(): void {
  const element = overlay.value?.querySelector<HTMLElement>(".stationary");
  const step = element ? parseFloat(getComputedStyle(element).lineHeight) : 0;
  if (element && step > 0 && element.scrollHeight - element.clientHeight - element.scrollTop > 1) {
    element.scrollTop += step;
    staticTimer = setTimeout(advanceStaticLine, duration.value * 1000);
  } else {
    entries.value = [];
  }
}

/**
 * 将完整回复放入可用轨道，换行在滚动模式下按空格显示
 * @param message - 主进程已提交的陪伴消息
 */
function receive(message: CompanionMessage): void {
  if (message.role !== "assistant" || entries.value.some((entry) => entry.id === message.id))
    return;
  const text = message.text.trim();
  if (!text) return;
  if (props.reducedMotion) {
    clearTimeout(staticTimer);
    clearAnimations();
    entries.value = [{ id: message.id, text, lane: 0 }];
    staticTimer = setTimeout(advanceStaticLine, duration.value * 1000);
    return;
  }
  for (let lane = 0; lane < props.lanes; lane++) {
    if (entries.value.every((entry) => entry.lane !== lane)) {
      entries.value = [...entries.value, { id: message.id, text, lane }];
      return;
    }
  }
}

/**
 * 移除已滚出可视范围的消息并释放轨道
 * @param id - 已结束动画的消息 ID
 */
function finish(id: string): void {
  cancelAnimation(id);
  entries.value = entries.value.filter((entry) => entry.id !== id);
}

watch(
  () => props.lanes,
  (lanes) => {
    for (const entry of entries.value) {
      if (entry.lane >= lanes) cancelAnimation(entry.id);
    }
    entries.value = entries.value.filter((entry) => entry.lane < lanes);
  },
);
watch(
  () => props.reducedMotion,
  () => {
    clearTimeout(staticTimer);
    clearAnimations();
    entries.value = [];
  },
);
const unsubscribe = window.api.companion.onDanmaku(receive);
onScopeDispose(() => {
  unsubscribe();
  clearTimeout(staticTimer);
  clearAnimations();
});
</script>

<template>
  <div
    ref="overlay"
    aria-hidden="true"
    class="companion-danmaku"
    :style="{ height: lanes * 1.5 + 'rem', '--travel-time': duration + 's' }"
  >
    <span
      v-for="entry in entries"
      :key="entry.id"
      class="remark"
      :class="reducedMotion ? 'stationary' : 'scrolling'"
      :style="{ top: entry.lane * 1.5 + 'rem' }"
      @vue:mounted="(vnode: VNode) => startScroll(vnode, entry.id)"
      @animationend="finish(entry.id)"
    >
      {{ entry.text }}
    </span>
  </div>
</template>

<style scoped>
.companion-danmaku {
  position: absolute;
  inset: 3.5rem 0 auto;
  pointer-events: none;
  overflow: clip;
  user-select: none;
  contain: strict;
  z-index: 6;
}
.remark {
  position: absolute;
  left: 0;
  width: max-content;
  color: white;
  text-shadow: 0 1px 3px rgb(0 0 0 / 70%);
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.5rem;
  white-space: nowrap;
  contain: layout style;
}
.scrolling {
  transform: translate3d(100vw, 0, 0);
  will-change: transform;
}
.fallback-scroll {
  animation: travel var(--danmaku-duration, var(--travel-time)) linear forwards;
}
.stationary {
  inset-inline: 1rem;
  width: auto;
  height: 1.5rem;
  overflow: hidden;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
  transform: none;
}
@keyframes travel {
  from {
    transform: translate3d(var(--danmaku-from, 100vw), 0, 0);
  }
  to {
    transform: translate3d(var(--danmaku-to, -100%), 0, 0);
  }
}
</style>
