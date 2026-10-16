<script setup lang="ts">
import { useAiLyricTranslation } from "@/composables/useAiLyricTranslation";
import { TRANSLATION_LANGUAGES, type TranslationLanguage } from "@/services/lyric/aiTranslation";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { toast } from "@/composables/useToast";
import { GENERATION_TASKS } from "@/services/lyric/aiGeneration";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();
const settingsDialog = useSettingsDialog();
const {
  targetLanguage,
  selected,
  coverage,
  hasSelection,
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
const needsTranslationLanguage = computed(
  () =>
    selected.value.translation ||
    (selected.value.wordTranslation && coverage.value.existing.translation < coverage.value.total),
);
const clearsAlignment = computed(
  () =>
    (selected.value.translation &&
      !selected.value.wordTranslation &&
      media.parsedLyric.some((line) => line.translationWords?.length)) ||
    (selected.value.romanization &&
      !selected.value.wordRomanization &&
      media.parsedLyric.some(
        (line) =>
          line.romanizationWords?.length || line.words.some((word) => word.romanWord?.trim()),
      )),
);

const configureModel = (): void => {
  emit("update:open", false);
  settingsDialog.show("aiIntegration", "aiModelConfig");
};

const applyTranslation = (): void => {
  if (!apply()) return;
  if (selected.value.translation || selected.value.wordTranslation)
    settings.lyric.showTranslation = true;
  if (selected.value.wordTranslation) settings.lyric.showWordTranslation = true;
  if (selected.value.romanization) settings.lyric.showRomanization = true;
  if (selected.value.wordRomanization) settings.lyric.showWordRomanization = true;
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
      <div class="flex flex-col gap-3" role="group" :aria-label="t('player.aiTranslation.tasks')">
        <div class="text-sm font-medium text-on-surface">{{ t("player.aiTranslation.tasks") }}</div>
        <div class="grid grid-cols-2 gap-3">
          <div
            v-for="task in GENERATION_TASKS"
            :key="task"
            class="rounded-lg border border-solid border-outline-variant/25 p-3"
            :data-generation-task="task"
          >
            <SCheckbox
              v-model:checked="selected[task]"
              :disabled="busy || !rows.length"
              :label="t(`player.aiTranslation.taskLabels.${task}`)"
            />
            <div class="mt-1 text-xs leading-5 text-on-surface-variant">
              {{
                t(
                  coverage.existing[task]
                    ? "player.aiTranslation.existingCount"
                    : "player.aiTranslation.missing",
                  { done: coverage.existing[task], total: coverage.total },
                )
              }}
            </div>
          </div>
        </div>
        <p class="m-0 text-xs leading-5 text-on-surface-variant">
          {{ t("player.aiTranslation.selectionHint") }}
        </p>
        <p v-if="clearsAlignment" class="m-0 text-xs leading-5 text-on-surface-variant">
          {{ t("player.aiTranslation.resetAlignmentHint") }}
        </p>
        <p
          v-if="selected.wordTranslation || selected.wordRomanization"
          class="m-0 text-xs leading-5 text-on-surface-variant"
        >
          {{ t("player.aiTranslation.alignmentHint") }}
        </p>
        <p v-if="!hasSelection && rows.length" class="m-0 text-xs text-on-surface-variant">
          {{ t("player.aiTranslation.selectAtLeastOne") }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <span v-if="needsTranslationLanguage" class="shrink-0 text-sm text-on-surface-variant">
          {{ t("player.aiTranslation.target") }}
        </span>
        <div
          v-if="needsTranslationLanguage"
          class="w-44 shrink-0"
          role="group"
          :aria-label="t('player.aiTranslation.target')"
        >
          <SSelect
            :model-value="targetLanguage"
            :options="languageOptions"
            :disabled="busy || !needsTranslationLanguage"
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
              v-if="selected.translation || selected.wordTranslation || item.translation"
              class="mt-1 whitespace-pre-wrap break-words text-sm leading-6"
              :class="item.translation ? 'text-primary' : 'text-on-surface-variant/50'"
            >
              {{ item.translation || t("player.aiTranslation.waiting") }}
            </div>
            <div
              v-if="selected.romanization || selected.wordRomanization || item.romanization"
              class="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-on-surface-variant"
              data-ai-romanization
            >
              {{ item.romanization || t("player.aiTranslation.waiting") }}
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
          {{ t("player.aiTranslation.applySelected") }}
        </SButton>
      </div>
    </template>
  </SDialog>
</template>
