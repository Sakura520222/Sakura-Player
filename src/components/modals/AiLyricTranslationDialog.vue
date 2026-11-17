<script setup lang="ts">
import { useAiLyricTranslation } from "@/composables/useAiLyricTranslation";
import { TRANSLATION_LANGUAGES, type TranslationLanguage } from "@/services/lyric/aiTranslation";
import { useMediaStore } from "@/stores/media";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { toast } from "@/composables/useToast";
import { GENERATION_TASKS, type GenerationMode } from "@/services/lyric/aiGeneration";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; "after-close": [] }>();
const { t } = useI18n();
const media = useMediaStore();
const settingsDialog = useSettingsDialog();
const {
  targetLanguage,
  generationMode,
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
  generationCount,
  preservedCount,
  canApply,
  canStart,
  canResume,
  runWithRetries,
  repairRomanizationLine,
  repairRomanization,
  repairTranslationLine,
  repairTranslation,
  cancel,
  apply,
} = useAiLyricTranslation(toRef(props, "open"));
const languageOptions = computed(() =>
  Object.keys(TRANSLATION_LANGUAGES).map((value) => ({
    value,
    label: t(`player.aiTranslation.languages.${value}`),
  })),
);
const generationModeOptions = computed(() =>
  (["missing", "full"] as const).map((value) => ({
    value,
    label: t(`player.aiTranslation.modes.${value}`),
  })),
);
const needsTranslationLanguage = computed(
  () =>
    (selected.value.translation || selected.value.wordTranslation) &&
    (generationMode.value === "full" || coverage.value.existing.translation < coverage.value.total),
);
const clearsAlignment = computed(
  () =>
    generationMode.value === "full" &&
    ((selected.value.translation &&
      !selected.value.wordTranslation &&
      media.parsedLyric.some(
        (line, id) => !media.aiLyricExcludedIds.has(id) && line.translationWords?.length,
      )) ||
      (selected.value.romanization &&
        !selected.value.wordRomanization &&
        media.parsedLyric.some(
          (line, id) =>
            !media.aiLyricExcludedIds.has(id) &&
            (line.romanizationWords?.length || line.words.some((word) => word.romanWord?.trim())),
        ))),
);

const showTranslationPreview = computed(
  () =>
    phase.value !== "idle" &&
    (selected.value.translation ||
      selected.value.wordTranslation ||
      rows.value.some((row) => row.translation)),
);
const showRomanizationPreview = computed(
  () =>
    phase.value !== "idle" &&
    (selected.value.romanization ||
      selected.value.wordRomanization ||
      rows.value.some((row) => row.romanization)),
);
const previewRowHeight = computed(
  () => 48 + (showTranslationPreview.value ? 24 : 0) + (showRomanizationPreview.value ? 24 : 0),
);
const statusCaption = computed(() => {
  if (phase.value !== "idle")
    return t("player.aiTranslation.progress", {
      done: translatedCount.value,
      total: generationCount.value,
    });
  if (!rows.value.length) return "";
  if (!hasSelection.value) return t("player.aiTranslation.selectAtLeastOne");
  return generationCount.value
    ? t("player.aiTranslation.pendingCount", { count: generationCount.value })
    : t("player.aiTranslation.nothingMissing");
});

/** 关闭生成弹窗并定位设置中的 AI 模型配置 */
const configureModel = (): void => {
  emit("update:open", false);
  settingsDialog.show("aiIntegration", "aiModelConfig");
};

/** 通过共用应用流程提交结果并关闭预览 */
const applyTranslation = (): void => {
  if (!apply()) return;
  toast.success(t("player.aiTranslation.applied"));
  emit("update:open", false);
};
</script>

<template>
  <SDialog
    :open="props.open"
    :title="t('player.aiTranslation.title')"
    width="760px"
    @update:open="emit('update:open', $event)"
    @after-close="emit('after-close')"
  >
    <div class="flex flex-col gap-4" data-ai-lyric-translation>
      <div
        class="flex flex-wrap gap-x-4 gap-y-2"
        role="group"
        :aria-label="t('player.aiTranslation.tasks')"
        data-generation-options
      >
        <div
          v-for="task in GENERATION_TASKS"
          :key="task"
          class="flex items-center gap-1.5"
          :data-generation-task="task"
        >
          <SCheckbox
            v-model:checked="selected[task]"
            :disabled="busy || !rows.length"
            :label="t(`player.aiTranslation.taskLabels.${task}`)"
          />
          <span class="text-xs text-on-surface-variant/60">
            {{ coverage.existing[task] }}/{{ coverage.total }}
          </span>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="text-sm text-on-surface-variant">{{ t("player.aiTranslation.mode") }}</span>
        <div class="w-40">
          <SSelect
            :model-value="generationMode"
            :options="generationModeOptions"
            :disabled="busy"
            :aria-label="t('player.aiTranslation.mode')"
            @update:model-value="generationMode = $event as GenerationMode"
          />
        </div>
        <template v-if="needsTranslationLanguage">
          <span class="text-sm text-on-surface-variant">
            {{ t("player.aiTranslation.target") }}
          </span>
          <div class="w-40">
            <SSelect
              :model-value="targetLanguage"
              :options="languageOptions"
              :disabled="busy"
              :aria-label="t('player.aiTranslation.target')"
              @update:model-value="targetLanguage = $event as TranslationLanguage"
            />
          </div>
        </template>
      </div>
      <p v-if="clearsAlignment" class="m-0 text-xs text-on-surface-variant">
        {{ t("player.aiTranslation.resetAlignmentHint") }}
      </p>
      <div
        v-if="!loadingModel && !model"
        role="status"
        class="flex items-center justify-between gap-3 rounded-lg bg-on-surface/5 px-3 py-2"
      >
        <span class="text-sm text-on-surface-variant">{{ t("player.aiTranslation.noModel") }}</span>
        <SButton
          variant="text"
          type="primary"
          size="small"
          :disabled="busy"
          @click="configureModel"
        >
          {{ t("player.aiTranslation.configure") }}
        </SButton>
      </div>
      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant"
        role="status"
        aria-live="polite"
      >
        <SLoading v-if="busy && phase === 'running'" class="size-4 shrink-0" />
        <span v-if="statusCaption">{{ statusCaption }}</span>
        <span v-if="preservedCount && hasSelection && generationCount" class="text-xs">
          {{ t("player.aiTranslation.preserved", { count: preservedCount }) }}
        </span>
        <span v-if="phase === 'completed'" class="text-primary">
          {{ t("player.aiTranslation.completed") }}
        </span>
        <span v-else-if="phase === 'cancelled'">
          {{ busy ? t("player.aiTranslation.cancelling") : t("player.aiTranslation.cancelled") }}
        </span>
        <span v-if="loadingModel || model" class="ml-auto min-w-0 truncate text-xs">
          {{
            loadingModel
              ? t("common.loading")
              : t("player.aiTranslation.model", { name: model!.name })
          }}
        </span>
      </div>
      <p v-if="error" class="m-0 text-sm text-error" role="alert">{{ error }}</p>
      <SVirtualList
        v-if="rows.length"
        :items="rows"
        :item-height="previewRowHeight"
        :get-item-key="(row) => row.id"
        height="min(42vh, 400px)"
        class="rounded-lg border border-solid border-outline-variant/25"
      >
        <template #default="{ item }">
          <div
            class="box-border border-b border-solid border-outline-variant/15 px-4 py-3"
            :style="{ height: `${previewRowHeight}px` }"
            :data-translation-line="item.id"
          >
            <div class="flex items-center gap-2">
              <span class="text-xs text-on-surface-variant">{{ item.id + 1 }}</span>
              <span class="min-w-0 flex-1 truncate text-sm">
                {{ item.text }}
              </span>
              <STag v-if="repairRomanizationLine === item.id" type="warning">
                {{ t("player.aiTranslation.needsRepair") }}
              </STag>
              <STag v-if="repairTranslationLine === item.id" type="warning">
                {{ t("player.aiTranslation.translationNeedsRepair") }}
              </STag>
            </div>
            <div
              v-if="showTranslationPreview"
              class="mt-1 truncate text-sm leading-5"
              :class="item.translation ? 'text-primary' : 'text-on-surface-variant/50'"
            >
              {{ item.translation || t("player.aiTranslation.waiting") }}
            </div>
            <div
              v-if="showRomanizationPreview"
              class="mt-1 truncate text-xs leading-5 text-on-surface-variant"
              data-ai-romanization
            >
              {{ item.romanization || t("player.aiTranslation.waiting") }}
            </div>
          </div>
        </template>
      </SVirtualList>
      <p v-else class="m-0 py-6 text-center text-sm text-on-surface-variant">
        {{ t("player.aiTranslation.noLyrics") }}
      </p>
    </div>
    <template #footer="{ close }">
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
        <SButton v-if="busy" variant="secondary" :disabled="phase !== 'running'" @click="cancel">
          {{ t("player.aiTranslation.cancel") }}
        </SButton>
        <SButton v-else variant="secondary" :disabled="!canStart" @click="runWithRetries(false)">
          {{ t(phase === "idle" ? "player.aiTranslation.start" : "player.aiTranslation.retry") }}
        </SButton>
        <SButton v-if="canResume" type="primary" variant="secondary" @click="runWithRetries(true)">
          {{
            t(
              phase === "error"
                ? "player.aiTranslation.resume"
                : "player.aiTranslation.resumeCancelled",
            )
          }}
        </SButton>
        <SButton
          v-if="repairRomanizationLine !== null"
          variant="secondary"
          @click="repairRomanization"
        >
          {{ t("player.aiTranslation.repairRomanization", { line: repairRomanizationLine + 1 }) }}
        </SButton>
        <SButton
          v-if="repairTranslationLine !== null"
          variant="secondary"
          @click="repairTranslation"
        >
          {{ t("player.aiTranslation.repairTranslation", { line: repairTranslationLine + 1 }) }}
        </SButton>
        <SButton type="primary" variant="secondary" :disabled="!canApply" @click="applyTranslation">
          {{ t("player.aiTranslation.applySelected") }}
        </SButton>
      </div>
    </template>
  </SDialog>
</template>
