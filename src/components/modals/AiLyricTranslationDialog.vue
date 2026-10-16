<script setup lang="ts">
import { useAiLyricTranslation } from "@/composables/useAiLyricTranslation";
import { TRANSLATION_LANGUAGES, type TranslationLanguage } from "@/services/lyric/aiTranslation";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { toast } from "@/composables/useToast";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();
const settingsDialog = useSettingsDialog();
const {
  targetLanguage,
  mode,
  model,
  loadingModel,
  rows,
  busy,
  phase,
  error,
  translatedCount,
  canApply,
  canStart,
  canResume,
  start,
  resume,
  cancel,
  apply,
} = useAiLyricTranslation(toRef(props, "open"));
const languageOptions = computed(() =>
  Object.keys(TRANSLATION_LANGUAGES).map((value) => ({
    value,
    label: t(`player.aiTranslation.languages.${value}`),
  })),
);

const configureModel = (): void => {
  emit("update:open", false);
  settingsDialog.show("aiIntegration", "aiModelConfig");
};

const applyTranslation = (): void => {
  if (!apply()) return;
  settings.lyric.showTranslation = true;
  if (mode.value === "aligned") {
    settings.lyric.showWordRomanization = true;
    settings.lyric.showWordTranslation = true;
  }
  toast.success(t("player.aiTranslation.applied"));
  emit("update:open", false);
};
</script>

<template>
  <SDialog
    :open="props.open"
    :title="t('player.aiTranslation.title')"
    width="720px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4" data-ai-lyric-translation>
      <div>
        <div class="truncate text-sm font-medium text-on-surface">{{ media.track?.title }}</div>
        <p class="m-0 mt-1 text-xs leading-5 text-on-surface-variant">
          {{ t("player.aiTranslation.hint") }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="shrink-0 text-sm text-on-surface-variant">
          {{ t("player.aiTranslation.mode") }}
        </span>
        <div class="w-64" role="group" :aria-label="t('player.aiTranslation.mode')">
          <SSelect
            :model-value="mode"
            :disabled="busy"
            :options="[
              { value: 'aligned', label: t('player.aiTranslation.alignedMode') },
              { value: 'line', label: t('player.aiTranslation.lineMode') },
            ]"
            @update:model-value="mode = $event as 'aligned' | 'line'"
          />
        </div>
        <p v-if="mode === 'aligned'" class="m-0 text-xs leading-5 text-on-surface-variant">
          {{ t("player.aiTranslation.alignmentHint") }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="shrink-0 text-sm text-on-surface-variant">
          {{ t("player.aiTranslation.target") }}
        </span>
        <div class="w-44 shrink-0" role="group" :aria-label="t('player.aiTranslation.target')">
          <SSelect
            :model-value="targetLanguage"
            :options="languageOptions"
            :disabled="busy"
            @update:model-value="targetLanguage = $event as TranslationLanguage"
          />
        </div>
        <span class="min-w-0 flex-1 truncate text-xs text-on-surface-variant" :title="model?.name">
          {{
            loadingModel
              ? t("common.loading")
              : model
                ? t("player.aiTranslation.model", { name: model.name })
                : t("player.aiTranslation.noModel")
          }}
        </span>
      </div>
      <div v-if="!loadingModel && !model" class="rounded-lg bg-on-surface/5 p-3">
        <SButton variant="secondary" size="small" @click="configureModel">
          {{ t("player.aiTranslation.configure") }}
        </SButton>
      </div>
      <div
        class="flex items-center gap-2 text-sm text-on-surface-variant"
        role="status"
        aria-live="polite"
      >
        <SLoading v-if="busy && phase === 'running'" class="size-4 shrink-0" />
        <span>
          {{ t("player.aiTranslation.progress", { done: translatedCount, total: rows.length }) }}
        </span>
        <span v-if="phase === 'completed'" class="text-primary">
          {{ t("player.aiTranslation.completed") }}
        </span>
        <span v-else-if="phase === 'cancelled'">
          {{ busy ? t("player.aiTranslation.cancelling") : t("player.aiTranslation.cancelled") }}
        </span>
      </div>
      <p v-if="error" class="m-0 text-sm text-error" role="alert">{{ error }}</p>
      <p v-if="canResume" class="m-0 text-xs leading-5 text-on-surface-variant">
        {{ t("player.aiTranslation.resumeHint") }}
      </p>
      <SVirtualList
        v-if="rows.length"
        :items="rows"
        :item-height="84"
        :get-item-key="(row) => row.id"
        height="min(42vh, 400px)"
        class="rounded-lg border border-solid border-outline-variant/25"
      >
        <template #default="{ item }">
          <div
            class="border-b border-solid border-outline-variant/15 px-4 py-3"
            :data-translation-line="item.id"
          >
            <div class="whitespace-pre-wrap break-words text-sm leading-6 text-on-surface">
              {{ item.text }}
            </div>
            <div
              class="mt-1 whitespace-pre-wrap break-words text-sm leading-6"
              :class="item.translation ? 'text-primary' : 'text-on-surface-variant/50'"
            >
              {{ item.translation || t("player.aiTranslation.waiting") }}
            </div>
            <div
              v-if="item.romanization"
              class="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-on-surface-variant"
              data-ai-romanization
            >
              {{ item.romanization }}
            </div>
          </div>
        </template>
      </SVirtualList>
      <p v-else class="m-0 py-8 text-center text-sm text-on-surface-variant">
        {{ t("player.aiTranslation.noLyrics") }}
      </p>
      <p class="m-0 text-xs leading-5 text-on-surface-variant">
        {{ t("player.aiTranslation.applyHint") }}
      </p>
    </div>
    <template #footer="{ close }">
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
        <SButton v-if="busy" variant="secondary" :disabled="phase !== 'running'" @click="cancel">
          {{ t("player.aiTranslation.cancel") }}
        </SButton>
        <SButton v-else variant="secondary" :disabled="!canStart" @click="start">
          {{ t(phase === "idle" ? "player.aiTranslation.start" : "player.aiTranslation.retry") }}
        </SButton>
        <SButton v-if="canResume" type="primary" variant="secondary" @click="resume">
          {{
            t(
              phase === "error"
                ? "player.aiTranslation.resume"
                : "player.aiTranslation.resumeCancelled",
            )
          }}
        </SButton>
        <SButton type="primary" variant="secondary" :disabled="!canApply" @click="applyTranslation">
          {{
            t(
              mode === "aligned"
                ? "player.aiTranslation.applyAligned"
                : settings.lyric.showTranslation
                  ? "player.aiTranslation.apply"
                  : "player.aiTranslation.applyAndShow",
            )
          }}
        </SButton>
      </div>
    </template>
  </SDialog>
</template>
