<script setup lang="ts">
import type { Component } from "vue";
import type { PlayerLayout } from "@/types/settings";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { resolvePlayerLayout } from "@/themes/registry";
import { materialKey } from "@/themes/material";
import { useImmersiveMode } from "@/composables/useImmersiveMode";
import {
  fullPlayerReady,
  playerTransitionActive,
  switchPlayerLayout,
} from "@/services/playerTransition";
import { fullPlayerContextKey } from "./context";
import ClassicLayout from "./layouts/standard/ClassicLayout.vue";
import FullCoverLayout from "./layouts/standard/FullCoverLayout.vue";
import FullLyricLayout from "./layouts/standard/FullLyricLayout.vue";
import AppleLayout from "./layouts/apple/AppleLayout.vue";

/** 布局设置与布局组件的对应关系 */
const LAYOUTS: Partial<Record<string, Component>> & Record<PlayerLayout, Component> = {
  classic: ClassicLayout,
  fullCover: FullCoverLayout,
  fullLyric: FullLyricLayout,
  apple: AppleLayout,
};

const status = useStatusStore();
const settings = useSettingsStore();
const theme = useThemeStore();
const { isPlaying, isPlayerExpanded } = storeToRefs(status);

const lyricMounted = ref(false);
const lyricReady = ref(false);
const contentPrepared = ref(false);
const playerVisible = ref(false);
const visualizerMounted = ref(false);
let visualizerIdle = 0;
const documentVisibility = useDocumentVisibility();
const themeMaterial = inject(materialKey);
const visibility = computed(
  () => themeMaterial?.value.visible ?? documentVisibility.value === "visible",
);

const contentActive = computed(
  () => isPlayerExpanded.value && contentPrepared.value && visibility.value,
);

/** 实际渲染的布局，与设置解耦以便在切换前截取旧快照 */
const selectedLayout = computed(() => {
  const id = resolvePlayerLayout(theme.themeId, theme.options, settings.player.layout);
  return LAYOUTS[id] ?? theme.definition.player?.component ?? ClassicLayout;
});
const layout = shallowRef(selectedLayout.value);
watch(selectedLayout, (value) => switchPlayerLayout(() => (layout.value = value)), {
  flush: "sync",
});

/** 歌词首帧就绪后在空闲时段创建可视化，避免布局测量与 WebGL 初始化争抢一帧 */
const scheduleVisualizers = (): void => {
  if (
    visualizerIdle ||
    visualizerMounted.value ||
    playerTransitionActive.value ||
    !isPlayerExpanded.value ||
    !visibility.value
  ) {
    return;
  }
  visualizerIdle = requestIdleCallback(
    () => {
      visualizerIdle = 0;
      if (isPlayerExpanded.value && !playerTransitionActive.value && visibility.value) {
        visualizerMounted.value = true;
      }
    },
    { timeout: 500 },
  );
};

/** 歌词完成首次布局后安排可视化初始化 */
const onLyricReady = (): void => {
  if (!isPlayerExpanded.value) return;
  lyricReady.value = true;
  scheduleVisualizers();
};

watch(visibility, (value) => {
  if (value && lyricReady.value) scheduleVisualizers();
});

/** 每次展开只初始化一次歌词，复用已挂载内容处理快速收起再展开 */
const preparePlayerContent = (): void => {
  if (contentPrepared.value) return;
  contentPrepared.value = true;
  lyricMounted.value = true;
  nextTick(() => {
    if (isPlayerExpanded.value && lyricReady.value) scheduleVisualizers();
  });
};

/** 展开前仅显示静态背景与封面 */
const onBeforeEnter = (): void => {
  playerVisible.value = true;
  contentPrepared.value = false;
};

/** 普通过渡完成后准备内容，共享过渡由快照结束驱动 */
const onAfterEnter = (): void => {
  if (!isPlayerExpanded.value || playerTransitionActive.value) return;
  preparePlayerContent();
};

watch(
  playerTransitionActive,
  (active, previous, onCleanup) => {
    if (active || !previous || !isPlayerExpanded.value) return;
    // 动画结束后再加载歌词引擎，避免解析抢占动画帧
    const idle = requestIdleCallback(
      () => {
        if (!playerTransitionActive.value && isPlayerExpanded.value) preparePlayerContent();
      },
      { timeout: 300 },
    );
    onCleanup(() => cancelIdleCallback(idle));
  },
  { immediate: true },
);

/** 收起前取消可视化初始化，歌词随 contentActive 冻结 */
const onBeforeLeave = (): void => {
  cancelIdleCallback(visualizerIdle);
  visualizerIdle = 0;
};

/** 收起结束后卸载歌词与可视化 */
const onAfterLeave = (): void => {
  playerVisible.value = false;
  lyricMounted.value = false;
  lyricReady.value = false;
  visualizerMounted.value = false;
};

onBeforeUnmount(() => cancelIdleCallback(visualizerIdle));

const {
  immersive,
  onPlayerMouseEnter,
  onPlayerMouseLeave,
  onMainMove,
  onBarEnter,
  onBarLeave,
  onBarFocusChange,
  controlMenuOpen,
  setControlMenuOpen,
} = useImmersiveMode(isPlayerExpanded);

provide(fullPlayerContextKey, {
  immersive,
  lyricMounted,
  contentActive,
  onLyricReady,
  onBarEnter,
  onBarLeave,
  controlMenuOpen,
  setControlMenuOpen,
});
</script>

<template>
  <Teleport to="body">
    <Transition
      appear
      :css="!playerTransitionActive"
      v-bind="theme.definition.motion.player"
      @after-enter="onAfterEnter"
      @before-enter="onBeforeEnter"
      @before-leave="onBeforeLeave"
      @after-leave="onAfterLeave"
    >
      <div
        v-show="isPlayerExpanded"
        class="player-panel fixed inset-0 z-200 overflow-hidden text-cover"
        :class="immersive ? 'cursor-none [&_*]:!cursor-none' : ''"
        style="--lp-color: rgb(var(--s-cover))"
        @mouseenter="onPlayerMouseEnter"
        @mousemove="onMainMove"
        @mouseleave="onPlayerMouseLeave"
        @focusin="onBarFocusChange"
        @focusout="onBarFocusChange"
      >
        <PlayerBackground
          :visible="playerVisible"
          :active="visualizerMounted"
          :suspended="!visibility"
        />
        <BottomSpectrum
          v-if="
            isPlayerExpanded &&
            visualizerMounted &&
            visibility &&
            settings.player.enableSpectrum &&
            !settings.reducedMotion
          "
          :show="isPlaying && immersive"
        />
        <component :is="layout" @vue:mounted="fullPlayerReady = true" />
      </div>
    </Transition>
  </Teleport>
</template>
