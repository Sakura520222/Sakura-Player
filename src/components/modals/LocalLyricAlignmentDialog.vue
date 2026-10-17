<script setup lang="ts">
import { useLocalLyricAlignment } from "@/composables/useLocalLyricAlignment";
import { toast } from "@/composables/useToast";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const { t } = useI18n();
const {
  translation,
  romanization,
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
const {
  status: environmentStatus,
  loading: environmentLoading,
  error: environmentError,
  busy: environmentBusy,
  installing,
  canInstall,
  canUninstall,
  progress: installProgress,
  install,
  cancelInstall,
  uninstall,
} = environment;

/** 应用辅助轨道，等待歌词视图刷新后提示本次实际应用的行数 */
const applyAlignment = async (): Promise<void> => {
  const tracks = apply();
  if (!tracks) return;
  await nextTick();
  toast.success(t("player.localAlignment.applied", { count: tracks.count }));
  emit("update:open", false);
};
</script>

<template>
  <SDialog
    :open="props.open"
    :title="t('player.localAlignment.title')"
    width="760px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-4">
      <p class="m-0 text-sm leading-6 text-on-surface-variant">
        {{ t("player.localAlignment.hint") }}
      </p>
      <div class="flex flex-wrap gap-4">
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
      <section class="flex flex-col gap-1.5">
        <SCheckbox
          v-model:checked="realignExisting"
          :disabled="busy"
          :label="t('player.localAlignment.realignExisting')"
        />
        <p class="m-0 text-xs leading-5 text-on-surface-variant">
          {{ t("player.localAlignment.realignHint") }}
        </p>
      </section>
      <section
        class="rounded-lg bg-on-surface/5 p-3 text-sm"
        :aria-label="t('player.localAlignment.environment')"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="font-medium">{{ t("player.localAlignment.environment") }}</span>
          <span role="status" aria-live="polite" class="text-xs text-on-surface-variant">
            {{
              environmentLoading
                ? t("player.localAlignment.environmentLoading")
                : t(`player.localAlignment.environmentPhases.${environmentStatus.phase}`)
            }}
          </span>
        </div>
        <p class="my-2 text-xs leading-5 text-on-surface-variant">
          {{ t("player.localAlignment.environmentHint") }}
        </p>
        <p v-if="!environmentStatus.supported" class="my-2 text-xs text-error">
          {{ t("player.localAlignment.unsupported") }}
        </p>
        <div v-if="environmentBusy" class="my-3 flex items-center gap-3">
          <SLoading class="size-4 shrink-0" />
          <progress
            v-if="installProgress !== null"
            class="h-2 flex-1 accent-primary"
            :value="installProgress"
            max="100"
            :aria-label="t('player.localAlignment.installProgress')"
          />
          <span v-if="installProgress !== null" class="text-xs tabular-nums">
            {{ installProgress }}%
          </span>
          <span v-else class="text-xs text-on-surface-variant">
            {{ t("player.localAlignment.installWaiting") }}
          </span>
        </div>
        <p
          v-if="environmentStatus.error || environmentError"
          class="my-2 whitespace-pre-wrap break-words text-xs text-error"
          role="alert"
        >
          {{ environmentError || environmentStatus.error }}
        </p>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <SButton
            v-if="!environmentStatus.installed && !installing"
            size="small"
            variant="secondary"
            :disabled="!canInstall || busy"
            @click="install"
          >
            {{ t("player.localAlignment.installEnvironment") }}
          </SButton>
          <SButton
            v-if="installing"
            size="small"
            variant="secondary"
            :disabled="environmentStatus.phase === 'cancelling'"
            @click="cancelInstall"
          >
            {{ t("player.localAlignment.cancelInstall") }}
          </SButton>
          <SButton
            v-if="environmentStatus.hasFiles && !installing"
            size="small"
            variant="secondary"
            :disabled="!canUninstall || busy"
            @click="uninstall"
          >
            {{ t("player.localAlignment.uninstallEnvironment") }}
          </SButton>
          <span v-if="environmentStatus.inUse" class="text-xs text-on-surface-variant">
            {{ t("player.localAlignment.environmentInUse") }}
          </span>
        </div>
      </section>
      <div
        role="status"
        aria-live="polite"
        class="flex items-center gap-2 text-sm text-on-surface-variant"
      >
        <SLoading v-if="busy" class="size-4" />
        <span>
          {{
            busy
              ? t("player.localAlignment.running")
              : completed
                ? t("player.localAlignment.summary", { done: results.length, total: rows.length })
                : t("player.localAlignment.ready", { count: rows.length })
          }}
        </span>
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
        :item-height="150"
        :get-item-key="(row) => row.id"
        height="min(42vh, 400px)"
        class="rounded-lg border border-solid border-outline-variant/25"
      >
        <template #default="{ item }">
          <div
            class="h-[150px] box-border border-b border-solid border-outline-variant/15 px-4 py-3"
            :data-alignment-line="item.id"
          >
            <div class="flex items-center gap-2">
              <SCheckbox
                v-if="completed && item.result"
                :checked="selected.has(item.id)"
                :disabled="busy"
                :label="String(item.id + 1)"
                @update:checked="select(item.id, $event)"
              />
              <span v-else class="text-xs text-on-surface-variant">{{ item.id + 1 }}</span>
              <span class="truncate text-sm">{{ item.text }}</span>
            </div>
            <div v-for="field in fields" :key="field" class="mt-2">
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
      <p class="m-0 text-xs leading-5 text-on-surface-variant">
        {{ t("player.localAlignment.applyHint") }}
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
