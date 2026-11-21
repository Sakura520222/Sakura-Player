import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import type { PlayerLayout } from "@/types/settings";
import { resolvePlayerLayout } from "./registry";

const standardLayouts = [
  { value: "classic", labelKey: "settings.playerLayout.classic" },
  { value: "fullCover", labelKey: "settings.playerLayout.fullCover" },
  { value: "fullLyric", labelKey: "settings.playerLayout.fullLyric" },
  { value: "apple", labelKey: "settings.playerLayout.apple" },
] satisfies { value: PlayerLayout; labelKey: string }[];

/** 读取当前主题提供的全屏布局选项 */
export function playerLayoutChoices() {
  const player = useThemeStore().definition.player;
  return player
    ? [{ value: player.id, labelKey: player.labelKey }, ...standardLayouts]
    : standardLayouts;
}

/** 读取当前主题实际使用的全屏布局 */
export function activePlayerLayout(): string {
  const theme = useThemeStore();
  return resolvePlayerLayout(theme.themeId, theme.options, useSettingsStore().player.layout);
}

/**
 * 仅更新当前主题的全屏布局
 * @param value - 布局设置或快捷菜单提供的选项
 */
export function setActivePlayerLayout(value: unknown): void {
  if (typeof value !== "string" || !playerLayoutChoices().some((option) => option.value === value))
    return;
  const theme = useThemeStore();
  if (theme.definition.player) theme.options.layout = { player: value };
  else useSettingsStore().player.layout = value as PlayerLayout;
}
