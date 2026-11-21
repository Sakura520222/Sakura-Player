<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";
import { getTheme, isThemeId, themeIds } from "@/themes/registry";

const theme = useThemeStore();
const { t } = useI18n();

/**
 * 选择已注册主题，保留各主题的独立配置
 * @param value - 预览卡片选择的主题 ID
 */
const selectTheme = (value: unknown): void => {
  if (isThemeId(value)) theme.themeId = value;
};
</script>

<template>
  <RadioGroupRoot
    :model-value="theme.themeId"
    :aria-label="t('settings.themePicker.label')"
    class="theme-picker"
    @update:model-value="selectTheme"
  >
    <RadioGroupItem v-for="id in themeIds" :key="id" :value="id" class="theme-choice">
      <span class="theme-preview" :data-preview="getTheme(id).preview" aria-hidden="true">
        <span class="theme-preview-nav" />
        <span class="theme-preview-rail">
          <i />
          <i />
          <i />
        </span>
        <span class="theme-preview-content">
          <i />
          <i />
          <i />
        </span>
        <span class="theme-preview-dock">
          <i />
          <IconLucidePlay />
          <i />
        </span>
      </span>
      <span class="theme-choice-label">
        <span>
          <strong>{{ getTheme(id).label }}</strong>
          <span class="theme-choice-description">{{ t(getTheme(id).descriptionKey) }}</span>
        </span>
        <RadioGroupIndicator class="theme-choice-check" aria-hidden="true">
          <IconLucideCheck />
        </RadioGroupIndicator>
      </span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style scoped>
.theme-picker {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr));
  gap: 12px;
}

.theme-choice {
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  text-align: start;
  min-width: 0;
  cursor: pointer;
  border-radius: 16px;
  border: 1px solid rgb(var(--s-outline-variant) / 0.5);
  background: rgb(var(--s-surface-alt));
}

.theme-choice[data-state="checked"] {
  border-color: color-mix(in srgb, rgb(var(--s-primary)) 65%, transparent);
}

.theme-choice:focus-visible {
  outline: 2px solid rgb(var(--s-primary));
  outline-offset: 3px;
}

.theme-choice-label {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 8px;
  padding: 12px;
}

.theme-choice-description {
  display: block;
  margin-top: 4px;
  color: rgb(var(--s-on-surface-variant));
  font-size: 12px;
}

.theme-choice-check {
  display: grid;
  flex: none;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 50%;
  background: rgb(var(--s-primary-container));
  color: rgb(var(--s-on-primary-container));
}

.theme-preview {
  position: relative;
  display: block;
  aspect-ratio: 16 / 7;
  min-height: 78px;
  overflow: hidden;
  background: #e8e5e4;
  color: #655c64;
}

.theme-preview > span {
  position: absolute;
  display: flex;
  gap: 5px;
  background: #d8d3d3;
}

.theme-preview-rail {
  flex-direction: column;
  inset: 0 76% 21% 0;
  padding: 15% 4% 0;
}

.theme-preview i {
  display: block;
  border-radius: 6px;
  background: currentColor;
  opacity: 0.38;
}

.theme-preview-rail i {
  height: 3px;
}

.theme-preview-nav {
  inset: 10% 7% auto 31%;
  height: 9%;
  border-radius: 4px;
}

.theme-preview .theme-preview-content {
  inset: 29% 7% 30% 31%;
  background: transparent;
}

.theme-preview-content i {
  flex: 1;
  aspect-ratio: 1;
  background: var(--preview-tile, #9b8188);
  opacity: 0.7;
}

.theme-preview-content i:nth-child(2) {
  --preview-tile: #777e91;
}

.theme-preview-content i:nth-child(3) {
  --preview-tile: #a3978e;
}

.theme-preview-dock {
  inset: auto 0 0;
  height: 21%;
  align-items: center;
  justify-content: center;
}

.theme-preview-dock svg {
  width: 12px;
  height: 12px;
}

.theme-preview-dock i {
  width: 13%;
  height: 2px;
}

[data-preview="liquid"] {
  background:
    radial-gradient(ellipse at 12% 15%, #424252, transparent 75%),
    radial-gradient(ellipse at 100% 100%, #503d4b, transparent 75%), #252531;
  color: #dfd9e5;
}

[data-preview="liquid"] > span:not(.theme-preview-content) {
  background: rgb(219 214 234 / 0.15);
  box-shadow: 0 5px 13px rgb(18 15 28 / 0.28);
}

[data-preview="liquid"] .theme-preview-rail {
  inset: 9% 76% 10% 5%;
  padding: 8% 3% 0;
  border-radius: 10px;
}

[data-preview="liquid"] .theme-preview-nav {
  height: 11%;
  border-radius: 8px;
}

[data-preview="liquid"] .theme-preview-dock {
  inset: auto 12% 9% 28%;
  border-radius: 12px;
}
</style>
