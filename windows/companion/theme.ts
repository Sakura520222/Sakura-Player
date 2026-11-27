import { shallowRef } from "vue";
import type { CompanionTheme } from "@shared/types/companion";

export const companionReducedMotion = shallowRef(false);

/**
 * 先订阅再拉取最新外观，首屏和后续更新都使用主窗口实际采用的主题
 * @param ready - 第一次拿到完整主题后挂载窗口内容
 * @returns 释放 IPC 与媒体偏好订阅的方法
 */
export function syncCompanionTheme(ready: () => void): () => void {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let current: CompanionTheme | null = null;
  let disposed = false;

  /** 结合浮窗自身的系统偏好与主窗口设置同步动态效果 */
  function updateMotion() {
    companionReducedMotion.value = media.matches || !!current?.reducedMotion;
    root.toggleAttribute("data-reduced-motion", companionReducedMotion.value);
  }

  /** 浮窗显隐独立于播放器主窗口 */
  function updateVisibility() {
    root.dataset.themeVisibility = document.hidden ? "hidden" : "visible";
  }

  /**
   * 替换主题变量并移除旧主题特有的字体或材质参数
   * @param theme - 主窗口最新生效的色板和主题参数
   */
  function applyTheme(theme: CompanionTheme) {
    const previous = current;
    current = theme;
    if (previous) {
      for (const key of Object.keys(previous.variables)) {
        if (!(key in theme.variables)) root.style.removeProperty(key);
      }
    }
    for (const [key, value] of Object.entries(theme.variables)) root.style.setProperty(key, value);
    root.dataset.theme = theme.theme;
    root.dataset.themeMaterial = theme.material;
    root.dataset.themeMotion = theme.motion;
    root.dataset.materialTier = theme.tier;
    root.dataset.appearanceStyle = theme.appearance;
    root.classList.toggle("dark", theme.dark);
    root.style.colorScheme = theme.dark ? "dark" : "light";
    updateMotion();
    if (!previous) ready();
  }

  const unsubscribe = window.api.companion.onTheme(applyTheme);
  void window.api.companion
    .getTheme()
    .then((snapshot) => {
      if (!disposed && !current && snapshot) applyTheme(snapshot);
    })
    .catch(() => {});
  updateVisibility();
  document.addEventListener("visibilitychange", updateVisibility);
  media.addEventListener("change", updateMotion);
  return () => {
    disposed = true;
    unsubscribe();
    media.removeEventListener("change", updateMotion);
    document.removeEventListener("visibilitychange", updateVisibility);
  };
}
