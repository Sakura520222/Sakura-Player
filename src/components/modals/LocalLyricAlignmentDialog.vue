<script setup lang="ts">
import { useLocalLyricAlignment } from "@/composables/useLocalLyricAlignment";
import { toast } from "@/composables/useToast";
import { useSettingsDialog } from "@/settings/useSettingsDialog";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean]; "after-close": [] }>();
const { t } = useI18n();
const {
  translation,
  romanization,
  primary,
  language,
  acousticEnvironment,
  realignExisting,
  environment,
  busy,
  completed,
  error,
  translationError,
  source,
  rows,
  coverage,
  fields,
  results,
  selected,
  canStart,
  canApply,
  start,
  cancel,
  select,
  apply,
} = useLocalLyricAlignment(toRef(props, "open"));
const settings = useSettingsDialog();
const languageOptions = computed(() =>
  (["zh", "ja", "en"] as const).map((value) => ({
    value,
    label: t(`player.localAlignment.languages.${value}`),
  })),
);
const missingModels = computed(() =>
  [
    {
      needed: primary.value,
      ready: acousticEnvironment.ready.value,
      loading: acousticEnvironment.loading.value,
      label: "settings.lyricAlignmentAcoustic.label",
    },
    {
      needed: translation.value && rows.value.some((line) => line.translation.trim()),
      ready: environment.ready.value,
      loading: environment.loading.value,
      label: "settings.lyricAlignmentTranslation.label",
    },
  ].filter((model) => model.needed && !model.loading && !model.ready),
);
const previewRowHeight = computed(() =>
  completed.value ? 48 + (primary.value ? 48 : 0) + fields.value.length * 48 : 48,
);

/** 关闭对齐弹窗并定位设置中的模型管理 */
const openModelSettings = (): void => {
  emit("update:open", false);
  settings.show("lyric", "lyricAlignmentModels");
};

/** 应用所选歌词结果，刷新后提示实际应用行数 */
const applyAlignment = async (): Promise<void> => {
  const tracks = apply();
  if (!tracks) return;
  emit("update:open", false);
  await nextTick();
  toast.success(t("player.localAlignment.applied", { count: tracks.count }));
};
</script>

<template>
  <SDialog
    :open="props.open"
    :title="t('player.localAlignment.title')"
    width="760px"
    @update:open="emit('update:open', $event)"
    @after-close="emit('after-close')"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-4">
        <SCheckbox
          v-model:checked="primary"
          :disabled="busy"
          :label="t('player.localAlignment.primary')"
        />
        <SCheckbox
          v-model:checked="romanization"
          :disabled="busy"
          :label="t('player.localAlignment.romanization')"
        />
        <SCheckbox
          v-model:checked="translation"
          :disabled="busy"
          :label="t('player.localAlignment.translation')"
        />
      </div>
      <div v-if="primary" class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="text-sm text-on-surface-variant">
          {{ t("player.localAlignment.language") }}
        </span>
        <div class="w-40">
          <SSelect
            v-model="language"
            :options="languageOptions"
            :disabled="busy"
            :aria-label="t('player.localAlignment.language')"
          />
        </div>
        <span class="text-xs text-on-surface-variant">
          {{ t("player.localAlignment.primaryWarning") }}
        </span>
      </div>
      <SCheckbox
        v-if="translation || romanization"
        v-model:checked="realignExisting"
        :disabled="busy"
        :label="t('player.localAlignment.realignExisting')"
      />
      <div
        role="status"
        aria-live="polite"
        class="flex h-8 shrink-0 items-center gap-2 text-sm text-on-surface-variant"
        data-alignment-status
      >
        <SLoading v-if="busy" class="size-4" />
        <span class="shrink-0">
          {{
            busy
              ? t("player.localAlignment.running")
              : completed
                ? t("player.localAlignment.summary", { done: results.length, total: rows.length })
                : t("player.localAlignment.ready", { count: rows.length })
          }}
        </span>
        <template v-if="missingModels.length">
          <span class="ml-auto min-w-0 truncate text-xs">
            {{
              t("player.localAlignment.modelsMissing", {
                models: missingModels.map((model) => t(model.label)).join(" / "),
              })
            }}
          </span>
          <SButton
            class="shrink-0"
            variant="text"
            type="primary"
            size="small"
            :disabled="busy"
            @click="openModelSettings"
          >
            {{ t("player.localAlignment.openModelSettings") }}
          </SButton>
        </template>
      </div>
      <div v-if="completed" class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant">
        <span v-for="item in coverage" :key="item.field">
          {{ t(`player.localAlignment.${item.field}`) }} ·
          {{
            t("player.localAlignment.trackSummary", {
              done: item.matched,
              total: item.total,
              existing: item.existing,
            })
          }}
        </span>
      </div>
      <p v-if="error || source.error" role="alert" class="m-0 text-sm text-error">
        {{ error || source.error }}
      </p>
      <div v-if="translationError" role="alert" class="rounded-lg bg-on-surface/5 p-3 text-sm">
        <p class="m-0">{{ t("player.localAlignment.translationUnavailable") }}</p>
        <details class="mt-2 text-xs">
          <summary>{{ t("player.localAlignment.details") }}</summary>
          <pre class="whitespace-pre-wrap break-words select-text">{{ translationError }}</pre>
        </details>
      </div>
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
            :data-alignment-line="item.id"
          >
            <div class="flex items-center gap-2">
              <SCheckbox
                v-if="
                  completed &&
                  (item.result?.primary || item.result?.translation || item.result?.romanization)
                "
                :checked="selected.has(item.id)"
                :disabled="busy"
                :label="String(item.id + 1)"
                @update:checked="select(item.id, $event)"
              />
              <span v-else class="text-xs text-on-surface-variant">{{ item.id + 1 }}</span>
              <span class="min-w-0 flex-1 truncate text-sm">
                {{ item.text }}
              </span>
              <STag v-if="item.result?.primary?.warnings?.length" type="warning">
                {{ t("player.localAlignment.needsReview") }}
              </STag>
            </div>
            <div v-if="completed && item.primary" class="mt-2">
              <div class="text-xs text-on-surface-variant">
                {{ t("player.localAlignment.primary") }} ·
                {{
                  item.result?.primary
                    ? t("player.localAlignment.matched")
                    : completed
                      ? t("player.localAlignment.uncertain")
                      : t("player.localAlignment.waiting")
                }}
              </div>
              <div class="mt-1 truncate text-sm text-primary">
                <span
                  v-for="(word, index) in item.result?.primary?.words"
                  :key="index"
                  class="mr-1 rounded bg-primary/10 px-1"
                >
                  {{ word.word }}
                </span>
                <span v-if="item.result?.reason" class="text-xs text-on-surface-variant">
                  {{ item.result.reason }}
                </span>
              </div>
            </div>
            <div v-for="field in completed ? fields : []" :key="field" class="mt-2">
              <div class="text-xs text-on-surface-variant">
                {{ t(`player.localAlignment.${field}`) }} ·
                {{
                  !item[field].trim()
                    ? item.original[field].trim()
                      ? t("player.localAlignment.alreadyAligned")
                      : t("player.localAlignment.noText")
                    : item.result?.[field]
                      ? t("player.localAlignment.matched")
                      : completed
                        ? t("player.localAlignment.uncertain")
                        : t("player.localAlignment.waiting")
                }}
              </div>
              <div class="mt-1 truncate text-sm whitespace-pre text-primary">
                <template v-if="item.result?.[field]">
                  <span
                    v-for="(part, index) in item.result[field]!.parts"
                    :key="index"
                    class="mr-1 rounded bg-primary/10 px-1"
                  >
                    {{ part.text }}
                  </span>
                </template>
                <span v-else class="text-on-surface-variant">{{ item.original[field] }}</span>
              </div>
            </div>
          </div>
        </template>
      </SVirtualList>
      <p v-else class="m-0 py-6 text-center text-sm text-on-surface-variant">
        {{ t("player.localAlignment.noLyrics") }}
      </p>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
      <SButton v-if="busy" variant="secondary" @click="cancel">
        {{ t("player.localAlignment.cancel") }}
      </SButton>
      <SButton v-else variant="secondary" :disabled="!canStart" @click="start">
        {{ t("player.localAlignment.start") }}
      </SButton>
      <SButton type="primary" variant="secondary" :disabled="!canApply" @click="applyAlignment">
        {{ t("player.localAlignment.apply") }}
      </SButton>
    </template>
  </SDialog>
</template>
