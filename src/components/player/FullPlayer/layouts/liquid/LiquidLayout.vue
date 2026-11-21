<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import LiquidLens from "@/themes/LiquidLens.vue";
import PlayerData from "../standard/PlayerData.vue";
import PlayerBottomBar from "../standard/PlayerBottomBar.vue";

const media = useMediaStore();
const status = useStatusStore();
const { t } = useI18n();
const hasLyrics = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);
const showLyrics = computed(() => hasLyrics.value && status.showLyric && !status.fullQueueOpen);

/** 在歌词与队列之间切换，保留全屏播放器的共享状态 */
const toggleLyrics = (): void => {
  if (status.fullQueueOpen) {
    status.fullQueueOpen = false;
    status.showLyric = true;
  } else {
    status.showLyric = !status.showLyric;
  }
};
</script>

<template>
  <div class="liquid-playing" data-liquid-player>
    <PlayerTopBar class="liquid-playing-top">
      <template #left>
        <SButton
          type="cover"
          variant="secondary"
          circle
          :size="40"
          :disabled="!hasLyrics"
          :aria-label="t('themes.toggleLyrics')"
          :aria-pressed="showLyrics"
          @click="toggleLyrics"
        >
          <template #icon><IconLucideTextQuote /></template>
        </SButton>
      </template>
    </PlayerTopBar>
    <div class="liquid-playing-stage" :data-companion="showLyrics || status.fullQueueOpen">
      <div class="liquid-album">
        <PlayerCover class="liquid-album-art" />
        <PlayerData align="left" class="liquid-album-data" />
      </div>
      <section v-show="showLyrics" class="liquid-playing-companion liquid-playing-lyrics group">
        <PlayerLyric :visible="showLyrics" />
        <LyricActions />
      </section>
      <section v-if="status.fullQueueOpen" class="liquid-playing-companion">
        <QueuePanel @close="status.fullQueueOpen = false" />
      </section>
    </div>
    <PlayerBottomBar class="liquid-playing-dock liquid-pane" data-theme-tone="cover">
      <LiquidLens priority :inactive="!status.isPlayerExpanded" />
    </PlayerBottomBar>
  </div>
</template>
