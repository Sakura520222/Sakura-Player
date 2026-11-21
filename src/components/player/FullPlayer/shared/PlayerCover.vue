<script lang="ts">
const hdCache = shallowRef<{ id: string; data: string } | null>(null);
</script>

<script setup lang="ts">
import { materialKey } from "@/themes/material";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();

/** 加载中的歌曲使用队列当前项作为封面兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);

const coverSrc = computed(() =>
  hdCache.value && hdCache.value.id === displayTrack.value?.id
    ? hdCache.value.data
    : displayTrack.value?.coverOriginal || displayTrack.value?.cover,
);

watchEffect(async (onCleanup) => {
  const id = displayTrack.value?.id;
  if (!status.isPlayerExpanded || status.trackLoading || !id) return;
  if (displayTrack.value?.source !== "local" || hdCache.value?.id === id) return;
  let current = true;
  onCleanup(() => (current = false));
  const r = await window.api.player.getCoverRaw();
  if (!current || displayTrack.value?.id !== id || !r.success || !r.data) return;
  hdCache.value = { id, data: r.data };
});

let layerId = 0;

/** 记录当前解码目标及其同曲兜底图 */
const createLayer = () => ({
  id: ++layerId,
  src: coverSrc.value,
  fallback: displayTrack.value?.cover,
});

const layers = shallowRef([createLayer()]);
let pendingLayer: ReturnType<typeof createLayer> | undefined;

watch([coverSrc, () => displayTrack.value?.cover], async (_, __, onCleanup) => {
  pendingLayer = undefined;
  const layer = createLayer();
  let current = true;
  const images: HTMLImageElement[] = [];
  onCleanup(() => {
    current = false;
    for (const image of images) image.removeAttribute("src");
  });
  for (const src of new Set([layer.src, layer.fallback])) {
    if (!src) continue;
    const image = new Image();
    image.src = src;
    images.push(image);
  }
  await Promise.any(images.map((image) => image.decode())).catch(() => {});
  images.length = 0;
  if (!current) return;

  // 已在淡入的新封面保留到不透明，避免高清图到达时重新暴露旧封面
  if (layers.value.length > 1) pendingLayer = layer;
  else layers.value = [layers.value[0], layer];
});

/**
 * 完成当前淡入，将它作为下一次过渡的底图
 * @param element - 已完成淡入的封面层
 */
const finishCoverEnter = (element: Element): void => {
  const current = layers.value.at(-1);
  if (!current || element.getAttribute("data-cover-layer") !== String(current.id)) return;
  const next = pendingLayer;
  pendingLayer = undefined;
  layers.value = next ? [current, next] : [current];
};

const motion = shallowRef<{ key: string; src: string } | null>(null);
const motionReady = ref(false);
const videoRef = ref<HTMLVideoElement>();
const material = inject(materialKey);
const visibility = useDocumentVisibility();
const canAnimate = computed(
  () =>
    status.isPlayerExpanded &&
    !settings.reducedMotion &&
    (material?.value.visible ?? visibility.value === "visible"),
);

watch(
  () =>
    [
      canAnimate.value && !status.trackLoading,
      settings.player.motionCoverSource,
      displayTrack.value?.id,
    ] as const,
  async ([active, source, id]) => {
    const key = `${source}:${id}`;
    if (motion.value && motion.value.key !== key) {
      motion.value = null;
      motionReady.value = false;
    }
    if (!active || source === "off" || !id || !displayTrack.value || motion.value) return;
    const src = await window.api.motionCover.resolve(toRaw(displayTrack.value), source);
    if (src && `${settings.player.motionCoverSource}:${displayTrack.value?.id}` === key) {
      motion.value = { key, src };
    }
  },
  { immediate: true },
);

// 跟随播放暂停，窗口隐藏时停止解码
watch([videoRef, () => status.isPlaying, canAnimate], ([video, playing, animate]) => {
  if (!video) return;
  if (playing && animate) video.play().catch(() => {});
  else video.pause();
});

/**
 * 移除后立即释放解码器与缓冲，不等 GC
 * @param el - 离场的视频元素
 */
const releaseVideo = (el: Element) => {
  const video = el as HTMLVideoElement;
  video.removeAttribute("src");
  video.load();
};

// 切换布局时组件直接卸载，不经过离场过渡
onBeforeUnmount(() => videoRef.value && releaseVideo(videoRef.value));
</script>

<template>
  <!-- 外观由布局决定，这里只负责高清封面加载与共享过渡标记 -->
  <div data-player-cover="full" class="relative overflow-hidden shrink-0">
    <!-- 切歌交叉淡入 -->
    <TransitionGroup
      :css="!settings.reducedMotion"
      enter-active-class="transition-opacity duration-500 ease-linear"
      enter-from-class="opacity-0"
      @after-enter="finishCoverEnter"
    >
      <DetailCover
        v-for="layer in layers"
        :key="layer.id"
        :data-cover-layer="layer.id"
        :src="layer.src"
        :fallback="layer.fallback"
        class="absolute! inset-0 size-full"
      />
    </TransitionGroup>
    <!-- 动态封面 -->
    <Transition
      leave-active-class="transition-opacity duration-500"
      leave-to-class="opacity-0"
      @after-leave="releaseVideo"
    >
      <video
        v-if="motion && status.isPlayerExpanded && !settings.reducedMotion"
        ref="videoRef"
        :key="motion.src"
        :src="motion.src"
        muted
        loop
        playsinline
        class="absolute inset-0 z-2 size-full object-cover transition-opacity duration-500"
        :class="motionReady ? 'opacity-100' : 'opacity-0'"
        @loadeddata="motionReady = true"
      />
    </Transition>
  </div>
</template>
