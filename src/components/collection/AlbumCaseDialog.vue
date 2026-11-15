<script setup lang="ts">
import type { Collection } from "@/types/collection";
import type { AlbumListeningStats } from "@shared/types/stats";
import { useSettingsStore } from "@/stores/settings";

const props = defineProps<{ collection: Collection }>();
const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();
const settings = useSettingsStore();
const listening = shallowRef<AlbumListeningStats | null>(null);
const localCover = shallowRef<string>();
const artist = computed(
  () => props.collection.artists?.map((item) => item.name).join(" / ") || props.collection.creator,
);
const largeCover = computed(
  () =>
    localCover.value ||
    props.collection.tracks.find((track) => track.cover === props.collection.cover)
      ?.coverOriginal ||
    props.collection.cover,
);

watch(
  [open, () => props.collection],
  async ([visible], _old, onCleanup) => {
    localCover.value = undefined;
    const track = props.collection.tracks.find((item) => item.cover === props.collection.cover);
    if (!visible || track?.source !== "local") return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    try {
      const result = await window.api.library.getAlbumCover(track.id);
      if (!cancelled && result.success && result.data) localCover.value = result.data;
    } catch (error) {
      console.warn("[album-case] 读取专辑大封面失败", error);
    }
  },
  { immediate: true },
);

watch(
  [open, () => props.collection],
  async ([visible], _old, onCleanup) => {
    listening.value = null;
    if (!visible) return;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    try {
      const result = await window.api.stats.getAlbumListeningStats(
        props.collection.tracks.map(({ id, source, serverId, serverRevision }) => ({
          id,
          source,
          serverId,
          serverRevision,
        })),
      );
      if (!cancelled) listening.value = result;
    } catch (error) {
      console.warn("[album-case] 读取听歌手记失败", error);
    }
  },
  { immediate: true },
);
</script>

<template>
  <SDialog
    v-model:open="open"
    :title="t('collection.albumCase.title')"
    width="min(960px, calc(100vw - 48px))"
    height="min(780px, 85vh)"
    :content-style="{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }"
    destroy-on-close
  >
    <div class="album-case-view bg-surface-alt text-on-surface">
      <div class="album-case-canvas">
        <AlbumCase
          :cover="largeCover"
          :thumbnail="collection.cover"
          :title="collection.title"
          :listening="listening"
          :active="open"
          :reduce-motion="settings.reducedMotion"
        />
      </div>
      <div class="album-case-caption">
        <h2>{{ collection.title }}</h2>
        <p v-if="artist" class="text-on-surface-variant">{{ artist }}</p>
      </div>
    </div>
  </SDialog>
</template>

<style scoped>
.album-case-view {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.album-case-canvas {
  flex: 1;
  min-height: 0;
}
.album-case-caption {
  flex-shrink: 0;
  padding: 0 24px 22px;
  text-align: center;
}
.album-case-caption h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 650;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.album-case-caption p {
  margin: 7px 0 0;
  font-size: 14px;
  opacity: 0.7;
}
@media (max-height: 650px) {
  .album-case-caption {
    padding-bottom: 12px;
  }
  .album-case-caption h2 {
    font-size: 20px;
  }
}
</style>
