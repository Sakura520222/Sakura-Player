import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";

/** 悬浮播放栏底部留白 */
const PLAYER_BAR_GAP = 112;

/**
 * 悬浮播放栏状态
 */
export const useFloatingPlayerBar = () => {
  const settings = useSettingsStore();
  const media = useMediaStore();
  const theme = useThemeStore();

  /** 是否处于悬浮播放栏 */
  const isFloatingBar = computed(
    () =>
      (theme.definition.capabilities.compactDock ||
        settings.appearance.layoutMode === "floating") &&
      !!media.track,
  );

  return { isFloatingBar, PLAYER_BAR_GAP };
};
