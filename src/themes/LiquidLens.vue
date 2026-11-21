<script setup lang="ts">
import { bakeLensMap, materialKey } from "./material";

const props = defineProps<{
  /** 平衡档也保留折射的重点表面 */
  priority?: boolean;
  /** 不可见的播放器不保留位移图 */
  inactive?: boolean;
}>();

const id = `sakura-lens-${useId()}`;
const surface = shallowRef<HTMLElement>();
const material = inject(materialKey);
const map = shallowRef<{ width: number; height: number; url: string }>();
const high = computed(() => material?.value.high ?? false);
const scale = computed(() => (material?.value.refraction ?? 0) * 0.48);
const disperse = computed(
  () => high.value && props.priority && !!map.value && map.value.width * map.value.height < 85_000,
);
const enabled = computed(
  () =>
    !props.inactive &&
    material?.value.visible &&
    material?.value.tier === "refraction" &&
    (props.priority || high.value),
);

watch(
  [surface, enabled, high],
  ([element, active, detail], _, onCleanup) => {
    if (!element || !active) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      // 缩放窗口时沿用上一张位移图，尺寸稳定后再烘焙
      timer = setTimeout(() => {
        const { clientWidth: width, clientHeight: height } = element;
        const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
        const physicalPixels = width * height * devicePixelRatio ** 2;
        if (width > 0 && height > 0 && physicalPixels <= (detail ? 950_000 : 425_000))
          map.value = { width, height, url: bakeLensMap(width, height, radius, detail) };
        else map.value = undefined;
      }, 70);
    });
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      clearTimeout(timer);
      map.value = undefined;
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
        :width="map.width"
        :height="map.height"
        filterUnits="userSpaceOnUse"
        color-interpolation-filters="sRGB"
      >
        <feImage
          :href="map.url"
          :width="map.width"
          :height="map.height"
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
        />
        <template v-else>
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            :scale="scale * 1.07"
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
            :scale="scale * 0.93"
            xChannelSelector="R"
            yChannelSelector="G"
            result="b"
          />
          <feColorMatrix in="b" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
          <feBlend in="red" in2="green" mode="screen" result="channels" />
          <feBlend in="channels" in2="blue" mode="screen" result="bent" />
          <feColorMatrix
            in="map"
            values="0 0 0 0 .85  0 0 0 0 .79  0 0 0 0 .88  0 0 1 0 0"
            result="reflectedLight"
          />
          <feComposite in="reflectedLight" in2="bent" operator="in" result="reflection" />
          <feBlend in="bent" in2="reflection" mode="screen" />
        </template>
      </filter>
    </svg>
  </span>
</template>
