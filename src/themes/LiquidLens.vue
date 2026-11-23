<script setup lang="ts">
import { bakeLensMap, materialKey, type LensMap } from "./material";

const props = defineProps<{
  /** 平衡档也保留折射的重点表面 */
  priority?: boolean;
  /** 不可见的播放器不保留位移图 */
  inactive?: boolean;
}>();

interface SurfaceOptics {
  blur: number;
  strength: number;
}

interface LiveSize {
  width: number;
  height: number;
}

const id = `sakura-lens-${useId()}`;
const surface = shallowRef<HTMLElement>();
const material = inject(materialKey);
const map = shallowRef<LensMap>();
const liveSize = shallowRef<LiveSize>();
const optics = shallowRef<SurfaceOptics>({ blur: 10, strength: 1 });
const high = computed(() => material?.value.high ?? false);
const filterWidth = computed(() => liveSize.value?.width ?? map.value?.width ?? 0);
const filterHeight = computed(() => liveSize.value?.height ?? map.value?.height ?? 0);
const scale = computed(() => {
  const factor = (material?.value.refraction ?? 0) / 100;
  return factor * (map.value?.maxScale ?? 0) * optics.value.strength;
});
const disperse = computed(
  () =>
    high.value && props.priority && !!map.value && filterWidth.value * filterHeight.value < 140_000,
);
const enabled = computed(
  () =>
    !props.inactive &&
    material?.value.visible &&
    material?.value.tier === "refraction" &&
    (props.priority || high.value),
);

/**
 * 读取当前镜片容器的模糊半径、折射权重与几何尺寸并烘焙位移图
 * @param element - 镜片 DOM 容器
 * @param detail - 是否使用高质量位移图采样
 */
const measureAndBake = (element: HTMLElement, detail: boolean): void => {
  const { clientWidth: width, clientHeight: height } = element;
  liveSize.value = width > 0 && height > 0 ? { width, height } : undefined;
  const style = getComputedStyle(element);
  const radius = parseFloat(style.borderTopLeftRadius) || 0;
  const blur = Math.max(0, parseFloat(style.getPropertyValue("--liquid-blur")) || 10);
  const strength = Math.max(
    0,
    Math.min(1.2, parseFloat(style.getPropertyValue("--liquid-refract-strength")) || 1),
  );
  optics.value = { blur, strength };
  const physicalPixels = width * height * devicePixelRatio ** 2;
  if (width > 0 && height > 0 && physicalPixels <= (detail ? 1_200_000 : 550_000)) {
    map.value = bakeLensMap(width, height, radius, detail);
  } else {
    map.value = undefined;
  }
};

watch(
  [surface, enabled, high],
  ([element, active, detail], _, onCleanup) => {
    if (!element || !active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let initialized = false;
    const observer = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = element;
      // 实时同步滤镜视口，避免缩放窗口防抖期间在旧尺寸边界出现裁切接缝
      liveSize.value = width > 0 && height > 0 ? { width, height } : undefined;
      if (!initialized) {
        initialized = true;
        measureAndBake(element, detail);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => measureAndBake(element, detail), 70);
    });
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      clearTimeout(timer);
      map.value = undefined;
      liveSize.value = undefined;
    });
  },
  { flush: "post" },
);
</script>

<template>
  <span
    ref="surface"
    aria-hidden="true"
    class="liquid-lens"
    :style="map ? { '--liquid-refraction': `url(#${id})` } : undefined"
    :data-liquid-lens="map ? 'refracting' : undefined"
  >
    <svg v-if="map" class="liquid-lens-defs" aria-hidden="true" width="0" height="0">
      <filter
        :id="id"
        x="0"
        y="0"
        :width="filterWidth"
        :height="filterHeight"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feImage
          :href="map.url"
          :width="filterWidth"
          :height="filterHeight"
          preserveAspectRatio="none"
          result="map"
        />
        <feDisplacementMap
          v-if="!disperse"
          in="SourceGraphic"
          in2="map"
          :scale="scale"
          xChannelSelector="R"
          yChannelSelector="G"
          result="refracted"
        />
        <template v-else>
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            :scale="scale * 1.035"
            xChannelSelector="R"
            yChannelSelector="G"
            result="r"
          />
          <feColorMatrix in="r" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            :scale="scale"
            xChannelSelector="R"
            yChannelSelector="G"
            result="g"
          />
          <feColorMatrix
            in="g"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="green"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            :scale="scale * 0.965"
            xChannelSelector="R"
            yChannelSelector="G"
            result="b"
          />
          <feColorMatrix in="b" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
          <feBlend in="red" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue" mode="screen" result="refracted" />
        </template>
        <template v-if="optics.blur > 0">
          <feGaussianBlur
            in="refracted"
            :stdDeviation="optics.blur"
            edgeMode="duplicate"
            result="frosted"
          />
          <feColorMatrix
            in="map"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0"
            result="rimMask"
          />
          <feComposite in="refracted" in2="rimMask" operator="in" result="rimRefracted" />
          <feComposite in="rimRefracted" in2="frosted" operator="over" />
        </template>
      </filter>
    </svg>
  </span>
</template>
