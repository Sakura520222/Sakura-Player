<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useSongHighlightStore } from "@/stores/songHighlight";
import { useProgressLyric } from "@/composables/useProgressLyric";
import * as player from "@/core/player";

withDefaults(
  defineProps<{
    cover?: boolean;
    thumbSize?: number;
    trackHeight?: number;
  }>(),
  { cover: false, thumbSize: 12, trackHeight: 3 },
);

const status = useStatusStore();
const settings = useSettingsStore();
const highlight = useSongHighlightStore();
const { formatTooltip, snapToNearestLyric } = useProgressLyric();

/**
 * 拖动播放进度时沿用歌词吸附设置
 * @param value - 用户拖动到的毫秒位置
 */
const onSeekDragEnd = (value: number): void => {
  void player.seek(snapToNearestLyric(value));
};
</script>

<template>
  <div class="relative min-w-0">
    <SSlider
      :model-value="status.position"
      :min="0"
      :max="status.duration"
      :step="100"
      :track-height="trackHeight"
      :thumb-size="thumbSize"
      :always-show-thumb="false"
      :show-popover="settings.player.showProgressTooltip"
      :cover="cover"
      @drag-end="onSeekDragEnd"
    >
      <template #popover="{ value }">{{ formatTooltip(value) }}</template>
    </SSlider>
    <template v-if="highlight.enabled && status.duration > 0">
      <span
        v-for="segment in highlight.segments"
        :key="`range:${segment.startMs}`"
        class="absolute top-1/2 -translate-y-1/2 rounded-full bg-amber-400/60 pointer-events-none"
        :style="{
          left: `${(segment.startMs / status.duration) * 100}%`,
          width: `${(((segment.endMs ?? segment.startMs) - segment.startMs) / status.duration) * 100}%`,
          height: `${trackHeight}px`,
        }"
      />
    </template>
  </div>
</template>
