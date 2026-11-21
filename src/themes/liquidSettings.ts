import type { SettingSection } from "@/types/settings-schema";
import type { LiquidOptions } from "@/types/theme";
import ThemeMaterialStatus from "@/components/settings/custom/ThemeMaterialStatus.vue";

/**
 * 提供 Liquid 的材质和动效设置，供外观页面按注册表显示
 * @param defaults - 主题默认参数
 */
export const liquidSettings = (defaults: LiquidOptions): SettingSection[] => [
  {
    id: "themeMaterial",
    items: [
      {
        key: "themeRefraction",
        type: "slider",
        binding: { store: "theme", path: "options.material.refraction" },
        min: 0,
        max: 100,
        step: 5,
        defaultValue: defaults.material.refraction,
      },
      {
        key: "themeTransparency",
        type: "slider",
        binding: { store: "theme", path: "options.material.transparency" },
        min: 0,
        max: 100,
        step: 5,
        defaultValue: defaults.material.transparency,
      },
      {
        key: "themeRenderQuality",
        type: "select",
        binding: { store: "theme", path: "options.material.quality" },
        defaultValue: defaults.material.quality,
        options: [
          { value: "auto", labelKey: "themes.quality.auto" },
          { value: "high", labelKey: "themes.quality.high" },
          { value: "balanced", labelKey: "themes.quality.balanced" },
          { value: "low", labelKey: "themes.quality.low" },
        ],
      },
      {
        key: "themeMaterialStatus",
        type: "custom",
        component: ThemeMaterialStatus,
        fullWidth: true,
        searchable: false,
      },
      {
        key: "themeMotion",
        type: "select",
        binding: { store: "theme", path: "options.motion" },
        defaultValue: defaults.motion,
        options: [
          { value: "expressive", labelKey: "themes.motion.expressive" },
          { value: "reduced", labelKey: "themes.motion.reduced" },
        ],
      },
    ],
  },
];
