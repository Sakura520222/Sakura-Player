<script setup lang="ts">
import type { LyricSavePreviewTarget } from "@/types/lyric-preview";

const props = defineProps<{ open: boolean; targets: LyricSavePreviewTarget[] }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { t } = useI18n();
const selected = ref(0);
const target = computed(() => props.targets[selected.value]);
watch(
  () => props.targets,
  () => {
    selected.value = 0;
  },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('player.copyLyric.preview.title')"
    width="min(960px, calc(100vw - 32px))"
    destroy-on-close
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4 pb-1">
      <p class="text-xs text-on-surface/60">{{ t("player.copyLyric.preview.hint") }}</p>
      <div
        v-if="targets.length > 1"
        class="flex flex-wrap gap-2"
        role="tablist"
        :aria-label="t('player.copyLyric.saveFullLyrics')"
      >
        <SButton
          v-for="(item, index) in targets"
          :key="item.key"
          size="small"
          :variant="index === selected ? 'filled' : 'secondary'"
          role="tab"
          :aria-selected="index === selected"
          @click="selected = index"
        >
          {{ t(`player.copyLyric.preview.targets.${item.key}`) }}
        </SButton>
      </div>
      <template v-if="target">
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2 text-sm font-medium">
            {{ t(`player.copyLyric.preview.targets.${target.key}`) }}
            <span
              v-if="target.exists === false && !target.needsDestination && !target.error"
              class="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              {{ t("player.copyLyric.preview.newLyrics") }}
            </span>
          </div>
          <span v-if="target.path" class="break-all text-xs text-on-surface/50">
            {{ target.path }}
          </span>
          <p v-if="target.needsDestination" class="text-xs text-on-surface/60">
            {{ t("player.copyLyric.preview.chooseOnSave") }}
          </p>
        </div>
        <p v-if="target.error" role="alert" class="rounded-lg bg-error/10 p-3 text-sm text-error">
          {{ target.error }}
        </p>
        <section
          v-for="field in target.fields"
          :key="`${target.key}:${field.key}`"
          class="flex flex-col gap-2"
        >
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="font-medium">{{ t(`player.copyLyric.preview.fields.${field.key}`) }}</span>
            <span v-if="field.beforeFormat || field.afterFormat" class="text-on-surface/50">
              {{ field.beforeFormat?.toUpperCase() ?? t("player.copyLyric.preview.autoFormat") }} →
              {{ field.afterFormat?.toUpperCase() ?? t("player.copyLyric.preview.autoFormat") }}
            </span>
          </div>
          <LyricDiffView :before="field.before" :after="field.after" />
        </section>
      </template>
    </div>
    <template #footer>
      <SButton variant="secondary" @click="emit('update:open', false)">
        {{ t("player.copyLyric.preview.back") }}
      </SButton>
    </template>
  </SDialog>
</template>
