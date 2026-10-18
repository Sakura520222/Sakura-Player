<script setup lang="ts">
import { useSongHighlightStore } from "@/stores/songHighlight";
import { useStatusStore } from "@/stores/status";
import { toast } from "@/composables/useToast";
import { formatTime } from "@/utils/time";

withDefaults(defineProps<{ cover?: boolean }>(), { cover: false });
const { t } = useI18n();
const highlight = useSongHighlightStore();
const status = useStatusStore();

const label = computed(() => {
  if (highlight.phase === "loading") return t("songHighlight.loading");
  const segment = highlight.nextSegment;
  const data = highlight.highlight;
  if (segment && data) {
    const range = segment.endMs
      ? `${formatTime(segment.startMs)}–${formatTime(segment.endMs)}`
      : formatTime(segment.startMs);
    return t("songHighlight.jump", {
      range,
      source: t(`songHighlight.sources.${data.platform}`),
    });
  }
  return t(highlight.phase === "error" ? "songHighlight.errorRetry" : "songHighlight.emptyRetry");
});

/** 获取缺失标注并跳转，过期请求不触发下一首歌曲的播放操作或提示 */
const onClick = async (): Promise<void> => {
  if (!highlight.highlight) {
    const result = await highlight.fetchHighlight();
    if (!result) {
      if (highlight.phase === "empty") toast.info(t("songHighlight.empty"));
      else if (highlight.phase === "error") toast.warning(t("songHighlight.error"));
      return;
    }
    if (highlight.highlight !== result) return;
  }
  await highlight.seekToHighlight();
};
</script>

<template>
  <SButton
    v-if="highlight.enabled"
    :type="cover ? 'cover' : highlight.highlight ? 'primary' : 'default'"
    variant="ghost"
    circle
    size="large"
    :class="highlight.highlight ? undefined : cover ? 'text-cover/50' : 'text-on-surface-variant'"
    :loading="highlight.phase === 'loading'"
    :disabled="status.trackLoading || status.duration <= 0"
    :aria-label="label"
    @click="onClick"
  >
    <template #icon><IconLucideFlame /></template>
  </SButton>
</template>
