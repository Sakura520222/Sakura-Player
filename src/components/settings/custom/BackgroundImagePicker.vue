<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";
import IconLucideImage from "~icons/lucide/image";
import IconLucideImagePlus from "~icons/lucide/image-plus";
import IconLucideX from "~icons/lucide/x";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const theme = useThemeStore();

const picking = ref(false);

/** 选图 */
const handlePick = async (): Promise<void> => {
  if (picking.value) return;
  const id = theme.themeId;
  picking.value = true;
  try {
    const url = await window.api.theme.pickBackgroundImage(id);
    if (url) theme.profiles[id].imageBackground.src = url;
  } finally {
    picking.value = false;
  }
};

/** 清除当前主题的背景，保留其他主题的图片 */
const handleClear = (): void => {
  theme.imageBackground.src = "";
  void window.api.theme.clearBackgroundImages(theme.themeId);
};
</script>

<template>
  <div class="flex items-center gap-3">
    <!-- 横向预览（背景图基本都是横屏，正方形会过度裁剪） -->
    <div
      class="w-24 h-14 shrink-0 rounded-lg border border-solid border-outline-variant/30 overflow-hidden bg-on-surface/5 flex items-center justify-center"
    >
      <img
        v-if="theme.imageBackground.src"
        :src="theme.imageBackground.src"
        class="w-full h-full object-cover"
        draggable="false"
        alt=""
      />
      <IconLucideImage v-else class="size-6 text-on-surface-variant/50" />
    </div>
    <SButton
      variant="secondary"
      size="small"
      circle
      :loading="picking"
      :aria-label="
        theme.imageBackground.src
          ? t('settings.backgroundImage.replace')
          : t('settings.backgroundImage.select')
      "
      @click="handlePick"
    >
      <template #icon><IconLucideImagePlus /></template>
    </SButton>
    <SButton
      v-if="theme.imageBackground.src"
      :disabled="picking"
      variant="ghost"
      size="small"
      circle
      :aria-label="t('settings.backgroundImage.clear')"
      @click="handleClear"
    >
      <template #icon><IconLucideX /></template>
    </SButton>
  </div>
</template>
