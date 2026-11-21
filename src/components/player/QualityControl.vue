<script setup lang="ts">
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import type { QualityLevel } from "@/utils/quality";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { AUDIO_OUTPUT_MODE_CONFIG_KEY, audioOutputModeSetting } from "@/settings/audioOutputMode";
import { confirmSettingChange } from "@/settings/confirmSettingChange";
import { getQualityLabel } from "@/utils/quality";
import * as player from "@/core/player";
import { isPlatform } from "@shared/types/platform";

const props = withDefaults(defineProps<{ cover?: boolean }>(), { cover: false });
const emit = defineEmits<{ "quick-menu-open-change": [open: boolean] }>();

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();
const status = useStatusStore();
const switchingOutput = ref(false);

/** 是否支持切换在线音质 */
const canSwitchQuality = computed(() => isPlatform(media.track?.source) && !media.track?.cloud);

/** 实际播放音质；详情加载前使用歌曲自身的音质信息。 */
const quality = computed(() => media.detail?.quality ?? media.track?.quality);
const qualityLabel = computed(() => getQualityLabel(quality.value));
const canSwitchOutput = computed(
  () =>
    props.cover === status.isPlayerExpanded && audioOutputModeSetting.visible() && !!media.track,
);

/** 音质偏好下拉选项 */
const qualityOptions = computed<SSelectOption[]>(() => [
  { value: "lq", label: t("settings.songLevel.lq") },
  { value: "sq", label: t("settings.songLevel.sq") },
  { value: "hq", label: t("settings.songLevel.hq") },
  { value: "lossless", label: t("settings.songLevel.lossless") },
  { value: "hi-res", label: t("settings.songLevel.hi-res") },
]);

const chipBase =
  "inline-flex min-w-9 shrink-0 items-center justify-center px-2 py-1 leading-none rounded-md border border-solid text-xs";

/**
 * 应用所选在线音质并重新加载当前歌曲
 * @param value - 在线音质选项的值
 */
const onQualityChange = (value: string | number | boolean): void => {
  settings.player.songLevel = value as QualityLevel;
  void player.reloadCurrentTrack();
};

const quickMenuItems = computed<DropdownMenuItem[]>(() => {
  const items: DropdownMenuItem[] = audioOutputModeSetting.options.map(({ value, labelKey }) => ({
    key: value,
    label: t(labelKey),
    checked: settings.system.player.audioOutputMode === value,
  }));
  if (canSwitchQuality.value) {
    items.push({
      key: "sourceQuality",
      label: t("settings.songLevel.switchTitle"),
      separator: true,
      children: qualityOptions.value.map(({ value, label }) => ({
        key: String(value),
        label,
        checked: settings.player.songLevel === value,
      })),
    });
  }
  return items;
});

/**
 * 从播放栏菜单应用输出模式或在线音质
 * @param key - 菜单所选项的标识
 */
const onQuickMenuSelect = async (key: string): Promise<void> => {
  if (switchingOutput.value) return;
  const mode = audioOutputModeSetting.options.find((option) => option.value === key)?.value;
  if (!mode) {
    const option = qualityOptions.value.find(({ value }) => value === key);
    if (canSwitchQuality.value && option && option.value !== settings.player.songLevel)
      onQualityChange(option.value);
    return;
  }
  if (settings.system.player.audioOutputMode === mode) return;
  switchingOutput.value = true;
  try {
    const confirmation = confirmSettingChange(audioOutputModeSetting.confirm, mode, t);
    if (confirmation && !(await confirmation)) return;
    await settings.setSystem(AUDIO_OUTPUT_MODE_CONFIG_KEY, mode);
  } finally {
    switchingOutput.value = false;
  }
};

watch(canSwitchOutput, (enabled) => {
  if (!enabled) emit("quick-menu-open-change", false);
});
onBeforeUnmount(() => emit("quick-menu-open-change", false));
</script>

<template>
  <SDropdownMenu
    v-if="canSwitchOutput"
    :items="quickMenuItems"
    side="top"
    align="end"
    :side-offset="8"
    :cover="cover"
    :modal="!cover"
    trigger-as-child
    @select="onQuickMenuSelect"
    @update:open="emit('quick-menu-open-change', $event)"
  >
    <template #header>
      <div
        class="px-2 pt-1 pb-1.5 text-xs font-medium"
        :class="cover ? 'text-cover/70' : 'text-on-surface-variant'"
      >
        {{ t("settings.audioOutputMode.label") }}
      </div>
    </template>
    <template #trigger>
      <button
        type="button"
        data-audio-output-mode-trigger
        :aria-label="`${qualityLabel} · ${t('settings.audioOutputMode.label')}`"
        :disabled="switchingOutput"
        :class="[
          chipBase,
          'cursor-pointer bg-transparent transition-colors focus-visible:outline-2 data-[state=open]:pointer-events-auto disabled:cursor-wait disabled:opacity-55',
          cover
            ? 'border-cover/30 text-cover/85 hover:border-cover/65 hover:bg-cover/10 focus-visible:outline-cover'
            : 'border-on-surface-variant/30 text-on-surface-variant hover:border-on-surface-variant/60 hover:bg-on-surface/5 focus-visible:outline-primary',
        ]"
      >
        {{ qualityLabel }}
      </button>
    </template>
  </SDropdownMenu>
  <SPopselect
    v-else-if="canSwitchQuality && media.track"
    :model-value="settings.player.songLevel"
    :options="qualityOptions"
    side="top"
    :side-offset="8"
    :cover="cover"
    @update:model-value="onQualityChange"
  >
    <template #header>
      <div
        :class="[
          'w-0 min-w-full px-2.5 pt-2 pb-1.5 text-xs leading-snug border-b border-b-solid',
          cover
            ? 'text-cover/55 border-b-white/10'
            : 'text-on-surface-variant/70 border-b-on-surface/8',
        ]"
      >
        <div class="mb-0.5 text-sm font-medium" :class="cover ? 'text-cover' : 'text-on-surface'">
          {{ t("settings.songLevel.switchTitle") }}
        </div>
        {{ t("settings.songLevel.switchHint") }}
      </div>
    </template>
    <template #trigger>
      <span
        :class="[
          chipBase,
          'cursor-pointer transition-colors',
          cover
            ? 'border-cover/30 text-cover/80 hover:border-cover/60'
            : 'border-on-surface-variant/30 text-on-surface-variant hover:border-on-surface-variant/60',
        ]"
      >
        {{ qualityLabel }}
      </span>
    </template>
  </SPopselect>
  <span
    v-else-if="media.track"
    :class="[
      chipBase,
      cover
        ? 'border-cover/25 text-cover/55'
        : 'border-on-surface-variant/25 text-on-surface-variant/80',
    ]"
  >
    {{ qualityLabel }}
  </span>
</template>
