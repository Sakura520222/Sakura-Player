import type { ThemeMode, ThemeSource, AppearanceStyle, ThemeProfile } from "@/types/theme";
import { deserializeTheme, getTheme, serializeTheme, type ThemeId } from "@/themes/registry";
import {
  generatePalette,
  themeColorVariables,
  extractColorFromImageUrl,
  DEFAULT_PRIMARY,
  SOLID_PALETTE_LIGHT,
  SOLID_PALETTE_DARK,
} from "@/utils/color";

/** 主题模式循环顺序 */
const MODE_CYCLE: ThemeMode[] = ["light", "dark", "system"];

export const useThemeStore = defineStore(
  "theme",
  () => {
    const initial = deserializeTheme("{}");
    const themeId = ref<ThemeId>(initial.themeId);
    const profiles = ref(initial.profiles);
    const definition = computed(() => getTheme(themeId.value));
    const profile = computed(() => profiles.value[themeId.value]);

    /**
     * 保留设置绑定入口，切换主题后读写当前主题的配置
     * @param key - 配置字段
     */
    const bindProfile = <K extends keyof ThemeProfile>(key: K) =>
      computed({
        get: () => profile.value[key],
        set: (value) => (profile.value[key] = value),
      });

    const mode = bindProfile("mode");
    const source = bindProfile("source");
    const customColor = bindProfile("customColor");
    const globalTint = bindProfile("globalTint");
    const appearanceStyle = bindProfile("appearanceStyle");
    const imageBackground = bindProfile("imageBackground");
    const options = bindProfile("options");
    const prefersReducedMotion = computed(
      () => definition.value.motion.prefersReduced?.(options.value) ?? false,
    );
    /** 封面取色 HEX */
    const coverColor = ref<string | null>(null);
    /** 从背景图提取的主色 */
    const imageColor = shallowRef<{ src: string; color: string | null }>();

    /** 实际生效的风格 */
    const effectiveStyle = computed<AppearanceStyle>(() =>
      appearanceStyle.value === "image" && !imageBackground.value.src
        ? "solid"
        : appearanceStyle.value,
    );
    const imageForcesDark = computed(
      () => definition.value.capabilities.imageForcesDark && appearanceStyle.value === "image",
    );
    const imageUsesClassicColors = computed(
      () => imageForcesDark.value && effectiveStyle.value === "image",
    );

    /** 系统暗色偏好 */
    const systemDark = usePreferredDark();

    /** 当前是否为暗色 */
    const isDark = computed(() => {
      if (imageUsesClassicColors.value) return true;
      if (mode.value === "dark") return true;
      if (mode.value === "light") return false;
      return systemDark.value;
    });

    /** 当前使用的主色 HEX */
    const activeColor = computed(() => {
      if (source.value === "cover" && coverColor.value) return coverColor.value;
      if (source.value === "custom") return customColor.value;
      return DEFAULT_PRIMARY;
    });

    /** 实际生效的全局着色 */
    const effectiveGlobalTint = computed(() => imageUsesClassicColors.value || globalTint.value);
    /** 实际生效的封面颜色 */
    const trackedColorForCover = computed(() => {
      if (!imageUsesClassicColors.value) return coverColor.value;
      const cached = imageColor.value;
      return cached?.src === imageBackground.value.src ? cached.color : null;
    });
    /** 实际生效的主色 HEX */
    const effectiveColor = computed(() => {
      if (source.value === "cover" && trackedColorForCover.value) return trackedColorForCover.value;
      if (source.value === "custom") return customColor.value;
      return DEFAULT_PRIMARY;
    });

    /** 主窗口和听歌伙伴使用同一份计算后的颜色，包括随封面变化的取色 */
    const colorVariables = computed(() => {
      const useSolid =
        source.value === "solid" || (source.value === "cover" && !trackedColorForCover.value);
      const palette = useSolid
        ? isDark.value
          ? SOLID_PALETTE_DARK
          : SOLID_PALETTE_LIGHT
        : generatePalette(effectiveColor.value, isDark.value, effectiveGlobalTint.value);
      return themeColorVariables(palette, coverColor.value);
    });

    /** 循环切换主题模式 */
    const cycleMode = (): void => {
      const idx = MODE_CYCLE.indexOf(mode.value);
      mode.value = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length];
    };

    /** 设置自定义主色 HEX */
    const setCustomColor = (hex: string): void => {
      customColor.value = hex;
      source.value = "custom";
    };

    /** 设置颜色来源 */
    const setSource = (newSource: ThemeSource): void => {
      source.value = newSource;
    };

    let initialized = false;
    /** 初始化主题应用与可取消的背景取色 */
    const init = (): void => {
      if (initialized) return;
      initialized = true;
      watch(
        () => (imageUsesClassicColors.value ? imageBackground.value.src : ""),
        (src, _, onCleanup) => {
          if (!src || imageColor.value?.src === src) return;
          let current = true;
          onCleanup(() => (current = false));
          void extractColorFromImageUrl(src).then((color) => {
            if (current) imageColor.value = { src, color };
          });
        },
        { immediate: true },
      );
      watchEffect(() => {
        const root = document.documentElement;
        for (const [key, value] of Object.entries(colorVariables.value))
          root.style.setProperty(key, value);
        root.classList.toggle("dark", isDark.value);
        root.dataset.appearanceStyle = effectiveStyle.value;
      });
    };

    return {
      themeId,
      profiles,
      definition,
      options,
      prefersReducedMotion,
      mode,
      source,
      customColor,
      globalTint,
      coverColor,
      appearanceStyle,
      imageBackground,
      imageForcesDark,
      isDark,
      activeColor,
      colorVariables,
      effectiveStyle,
      cycleMode,
      setCustomColor,
      setSource,
      init,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["themeId", "profiles"],
      serializer: { serialize: serializeTheme, deserialize: deserializeTheme },
    },
  },
);
