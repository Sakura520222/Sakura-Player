<script setup lang="ts">
import { useLyricAlignmentEnvironment } from "@/composables/useLyricAlignmentEnvironment";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import { formatFileSize } from "@/utils/format";
import { openExternal } from "@/utils/url";

const { t } = useI18n();
const { open } = useSettingsDialog();
const acoustic = useLyricAlignmentEnvironment(open, "acoustic");
const translation = useLyricAlignmentEnvironment(open);
const models = computed(() =>
  [
    { kind: "acoustic", key: "lyricAlignmentAcoustic", size: "302 MiB", environment: acoustic },
    {
      kind: "translation",
      key: "lyricAlignmentTranslation",
      size: "684 MiB",
      environment: translation,
    },
  ].map(({ environment, ...model }) => ({
    ...model,
    state: environment.status.value,
    loading: environment.loading.value,
    busy: environment.busy.value,
    error: environment.error.value || environment.status.value.error,
    installing: environment.installing.value,
    progress: environment.progress.value,
    canInstall: environment.canInstall.value,
    canUninstall: environment.canUninstall.value,
    install: environment.install,
    cancel: environment.cancelInstall,
    uninstall: environment.uninstall,
  })),
);
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <SCard v-for="model in models" :key="model.kind" variant="settings">
      <div class="flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-base text-on-surface">{{ t(`settings.${model.key}.label`) }}</div>
          <div class="mt-0.5 text-sm text-on-surface-variant/70">
            {{ t(`settings.${model.key}.description`) }} · {{ model.size }}
          </div>
        </div>
        <span role="status" class="text-xs text-on-surface-variant">
          {{
            model.loading
              ? t("player.localAlignment.environmentLoading")
              : model.state.inUse
                ? t("player.localAlignment.environmentInUse")
                : !model.state.supported
                  ? t("player.localAlignment.unsupported")
                  : t(`player.localAlignment.environmentPhases.${model.state.phase}`)
          }}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <SButton
            v-if="model.installing"
            variant="secondary"
            size="small"
            :disabled="model.state.phase === 'cancelling'"
            @click="model.cancel"
          >
            {{ t("common.cancel") }}
          </SButton>
          <SButton
            v-else-if="!model.state.installed"
            variant="secondary"
            type="primary"
            size="small"
            :disabled="!model.canInstall"
            @click="model.install"
          >
            {{
              t(
                model.state.hasFiles
                  ? "settings.lyricAlignmentModels.verify"
                  : "settings.lyricAlignmentModels.download",
              )
            }}
          </SButton>
          <SButton
            v-if="model.state.hasFiles && !model.installing"
            variant="secondary"
            size="small"
            :disabled="!model.canUninstall"
            @click="model.uninstall"
          >
            {{ t("settings.lyricAlignmentModels.remove") }}
          </SButton>
        </div>
      </div>
      <div v-if="model.busy" class="mt-3 flex items-center gap-3">
        <SLoading class="size-4 shrink-0" />
        <progress
          v-if="model.progress !== null"
          class="h-2 min-w-0 flex-1 accent-primary"
          :value="model.progress"
          max="100"
          :aria-label="t('player.localAlignment.installProgress')"
        />
        <span v-if="model.state.totalBytes" class="text-xs text-on-surface-variant">
          {{ formatFileSize(model.state.downloadedBytes) }} /
          {{ formatFileSize(model.state.totalBytes) }}
        </span>
      </div>
      <p v-if="model.error" role="alert" class="mt-2 mb-0 break-words text-xs text-error">
        {{ model.error }}
      </p>
      <div v-if="model.kind === 'acoustic'" class="mt-2 text-xs text-on-surface-variant/70">
        {{ t("settings.lyricAlignmentModels.nonCommercial") }} ·
        <a
          href="https://huggingface.co/xycld/lyric-align-mms-fa"
          class="text-primary hover:underline"
          @click.prevent="openExternal('https://huggingface.co/xycld/lyric-align-mms-fa')"
        >
          MMS · CC-BY-NC-4.0
        </a>
      </div>
    </SCard>
  </div>
</template>
