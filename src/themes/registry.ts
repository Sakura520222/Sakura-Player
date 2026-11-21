// @unocss-include 主题过渡类需进入生产样式表
import { defineAsyncComponent, type Component, type TransitionProps } from "vue";
import type { LiquidOptions, ThemeProfile } from "@/types/theme";
import type { PlayerLayout } from "@/types/settings";
import type { SettingSection } from "@/types/settings-schema";
import { classicShell, liquidShell, type ShellRegions, type ShellState } from "./shell";
import LiquidLens from "./LiquidLens.vue";
import { liquidSettings } from "./liquidSettings";

const CORE_PLAYER_LAYOUTS = ["classic", "fullCover", "fullLyric", "apple"] as const;

export interface ThemeDefinition {
  label: string;
  descriptionKey: string;
  preview: string;
  capabilities: {
    imageForcesDark: boolean;
    optics: boolean;
    compactDock: boolean;
    customShell: boolean;
  };
  defaults: ThemeProfile;
  shell: (state: ShellState) => ShellRegions;
  chrome?: { sidebar?: Component; navigation?: Component; dock?: Component };
  settingsSections?: SettingSection[];
  tokens: Record<`--${string}`, string>;
  material: {
    variant: string;
    lens?: Component;
    configure?: (options: unknown) => LiquidOptions["material"];
  };
  motion: {
    variant: string;
    route?: string;
    dock: TransitionProps;
    player: TransitionProps;
    sharedCover: boolean;
    prefersReduced?: (options: Record<string, unknown>) => boolean;
  };
  player?: { id: string; labelKey: string; component: Component };
  validateOptions?: (value: unknown) => Record<string, unknown>;
}

const LIQUID_DEFAULTS: LiquidOptions = {
  material: { refraction: 70, transparency: 48, quality: "auto" },
  layout: { player: "liquid" },
  motion: "expressive",
};

/** @param value - 待验证的配置对象 */
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * 选择已声明的值
 * @param value - 待验证的值
 * @param choices - 支持的值
 * @param fallback - 无效值的默认项
 */
const option = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? (value as T) : fallback;

/**
 * 约束存档中的连续数值
 * @param value - 待验证的值
 * @param min - 下限
 * @param max - 上限
 * @param fallback - 缺失或非数值时使用的值
 */
const numberIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(value, max))
    : fallback;

/**
 * 校验 Liquid 的材质、布局和动效配置
 * @param value - 存档中的主题选项
 */
export function validateLiquidOptions(value: unknown): Record<string, unknown> & LiquidOptions {
  const saved = record(value);
  const material = record(saved.material);
  const layout = record(saved.layout);
  return {
    material: {
      refraction: numberIn(material.refraction, 0, 100, LIQUID_DEFAULTS.material.refraction),
      transparency: numberIn(material.transparency, 0, 100, LIQUID_DEFAULTS.material.transparency),
      quality: option(material.quality, ["auto", "high", "balanced", "low"], "auto"),
    },
    layout: { player: option(layout.player, [...CORE_PLAYER_LAYOUTS, "liquid"], "liquid") },
    motion: option(saved.motion, ["expressive", "reduced"], "expressive"),
  };
}

const classicDefaults: ThemeProfile = {
  mode: "system",
  source: "default",
  customColor: "#fe7971",
  globalTint: false,
  appearanceStyle: "solid",
  imageBackground: { src: "", blur: 0, dim: 0.4, scale: 1.2 },
  options: {},
};

export const themeRegistry = {
  classic: {
    label: "Classic",
    descriptionKey: "themes.classicDescription",
    preview: "classic",
    capabilities: { imageForcesDark: true, optics: false, compactDock: false, customShell: false },
    defaults: classicDefaults,
    shell: classicShell,
    tokens: {},
    material: { variant: "standard" },
    motion: {
      variant: "standard",
      dock: {
        enterActiveClass: "transition-transform duration-300 ease-out",
        leaveActiveClass: "transition-transform duration-300 ease-in",
        enterFromClass: "translate-y-full",
        leaveToClass: "translate-y-full",
      },
      player: {
        enterActiveClass: "transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]",
        leaveActiveClass: "transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]",
        enterFromClass: "translate-y-full",
        leaveToClass: "translate-y-full",
      },
      sharedCover: false,
    },
  },
  "sakura-liquid": {
    label: "Sakura Liquid",
    descriptionKey: "themes.liquidDescription",
    preview: "liquid",
    capabilities: { imageForcesDark: false, optics: true, compactDock: true, customShell: true },
    defaults: { ...classicDefaults, options: { ...LIQUID_DEFAULTS } },
    shell: liquidShell,
    settingsSections: liquidSettings(LIQUID_DEFAULTS),
    tokens: {
      "--liquid-gap": "14px",
      "--liquid-rail-width": "216px",
      "--liquid-dock-height": "74px",
      "--liquid-radius": "24px",
      "--liquid-motion-short": "160ms",
      "--liquid-motion-surface": "270ms",
      "--liquid-motion-exit": "150ms",
      "--liquid-ease": "cubic-bezier(.16, 1, .32, 1)",
      "--liquid-spring": "linear(0, .39, .74, .96, 1.035, 1.025, 1)",
    },
    material: {
      variant: "liquid",
      lens: LiquidLens,
      configure: (options) => validateLiquidOptions(options).material,
    },
    motion: {
      variant: "liquid",
      route: "route-liquid",
      dock: { name: "liquid-dock-motion" },
      player: { name: "liquid-player-motion" },
      sharedCover: true,
      prefersReduced: (options) => options.motion === "reduced",
    },
    player: {
      id: "liquid",
      labelKey: "themes.playerLayout",
      component: defineAsyncComponent({
        loader: () => import("@/components/player/FullPlayer/layouts/liquid/LiquidLayout.vue"),
        suspensible: false,
      }),
    },
    validateOptions: validateLiquidOptions,
  },
} satisfies Record<string, ThemeDefinition>;

export type ThemeId = keyof typeof themeRegistry;
export const themeIds = Object.keys(themeRegistry) as ThemeId[];

/** @param id - 已注册主题 ID */
export const getTheme = (id: ThemeId): ThemeDefinition => themeRegistry[id];

/** @param id - 待校验的主题 ID */
export const isThemeId = (id: unknown): id is ThemeId =>
  typeof id === "string" && Object.hasOwn(themeRegistry, id);

/**
 * 解析主题布局，经典布局继续使用原有设置键
 * @param id - 当前主题
 * @param options - 当前主题专属配置
 * @param classicLayout - Classic 中保存的播放器布局
 */
export function resolvePlayerLayout(
  id: ThemeId,
  options: Record<string, unknown>,
  classicLayout: PlayerLayout,
): string {
  const player = getTheme(id).player;
  return player
    ? option(record(options.layout).player, [...CORE_PLAYER_LAYOUTS, player.id], player.id)
    : classicLayout;
}

/**
 * 保留有效背景和颜色配置，补齐缺失或损坏的字段
 * @param id - 配置所属的主题
 * @param value - 存档中的主题配置
 */
export function validateProfile(id: ThemeId, value: unknown): ThemeProfile {
  const { defaults, validateOptions } = getTheme(id);
  const saved = record(value);
  const image = record(saved.imageBackground);
  return {
    mode: option(saved.mode, ["light", "dark", "system"], defaults.mode),
    source: option(saved.source, ["default", "custom", "cover", "solid"], defaults.source),
    customColor:
      typeof saved.customColor === "string" &&
      /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(saved.customColor)
        ? saved.customColor
        : defaults.customColor,
    globalTint: typeof saved.globalTint === "boolean" ? saved.globalTint : defaults.globalTint,
    appearanceStyle: option(saved.appearanceStyle, ["solid", "image"], defaults.appearanceStyle),
    imageBackground: {
      src: typeof image.src === "string" ? image.src : defaults.imageBackground.src,
      blur: numberIn(image.blur, 0, 80, defaults.imageBackground.blur),
      dim: numberIn(image.dim, 0, 1, defaults.imageBackground.dim),
      scale: numberIn(image.scale, 1, 2, defaults.imageBackground.scale),
    },
    options: validateOptions?.(saved.options) ?? {},
  };
}

/**
 * 将未版本化外观迁入 Classic，并为每个注册主题独立恢复配置
 * @param value - Pinia 存档 JSON
 * @returns 校验后的主题状态
 */
export function deserializeTheme(value: string) {
  const saved = record(JSON.parse(value) as unknown);
  const versioned = typeof saved.version === "number";
  const profiles = record(saved.profiles);
  const themeId = versioned && isThemeId(saved.themeId) ? saved.themeId : "classic";
  return {
    themeId,
    profiles: Object.fromEntries(
      themeIds.map((id) => [
        id,
        validateProfile(id, versioned ? profiles[id] : id === "classic" ? saved : undefined),
      ]),
    ) as Record<ThemeId, ThemeProfile>,
  };
}

/**
 * 以版本化格式写入主题选择和各自配置
 * @param state - Pinia 持久化字段
 */
export function serializeTheme(state: Record<string, unknown>): string {
  return JSON.stringify({ version: 1, ...state });
}
