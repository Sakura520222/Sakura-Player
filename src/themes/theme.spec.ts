import { createPinia, setActivePinia } from "pinia";
import piniaPersistedstate from "pinia-plugin-persistedstate";
import { createApp } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { createLensMapPixels, resolveMaterial } from "./material";
import { activePlayerLayout, setActivePlayerLayout } from "./playerLayout";
import { deserializeTheme, getTheme, isThemeId, serializeTheme, themeIds } from "./registry";

const legacy = {
  mode: "light",
  source: "custom",
  customColor: "#193fde",
  globalTint: true,
  appearanceStyle: "image",
  imageBackground: { src: "cache://background/test.jpg", blur: 24, dim: 0.65, scale: 1.55 },
};

/** 创建启用真实持久化插件的独立 Pinia 实例 */
function setupPinia() {
  const pinia = createPinia().use(piniaPersistedstate);
  createApp({ render: () => null }).use(pinia);
  setActivePinia(pinia);
  return pinia;
}

beforeEach(() => {
  localStorage.clear();
  const subscribe = () => () => {};
  const closed = async () => false;
  vi.stubGlobal("api", {
    desktopLyric: { onConfigChange: subscribe },
    dynamicIsland: { onConfigChange: subscribe },
    window: {
      onDesktopLyricVisibilityChange: subscribe,
      onDynamicIslandVisibilityChange: subscribe,
      onTaskbarLyricVisibilityChange: subscribe,
      isDesktopLyricOpen: closed,
      isDynamicIslandOpen: closed,
      isTaskbarLyricOpen: closed,
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("主题注册与迁移", () => {
  it("只识别已注册的稳定 ID，并给每套主题提供独立默认配置", () => {
    expect(themeIds).toEqual(["classic", "sakura-liquid"]);
    expect(isThemeId("__proto__")).toBe(false);
    expect(getTheme("classic").capabilities.imageForcesDark).toBe(true);
    expect(getTheme("sakura-liquid").player?.id).toBe("liquid");
    expect(deserializeTheme("{}").profiles.classic.imageBackground).not.toBe(
      deserializeTheme("{}").profiles["sakura-liquid"].imageBackground,
    );
  });

  it("旧版外观原样进入 Classic，并保留该主题的图片暗色行为", () => {
    localStorage.setItem("theme", JSON.stringify(legacy));
    setupPinia();
    const theme = useThemeStore();
    expect(theme.themeId).toBe("classic");
    expect(theme.profiles.classic).toMatchObject(legacy);
    expect(theme.isDark).toBe(true);
    theme.themeId = "sakura-liquid";
    theme.mode = "light";
    theme.appearanceStyle = "image";
    theme.imageBackground.src = legacy.imageBackground.src;
    expect(theme.isDark).toBe(false);
  });

  it("修复损坏的设置与未知 ID，同时保留有效的独立配置", () => {
    const migrated = deserializeTheme(
      serializeTheme({
        themeId: "removed-theme",
        profiles: {
          classic: {
            mode: "invalid",
            source: "custom",
            customColor: "#1a2",
            imageBackground: { blur: -1 },
          },
          "sakura-liquid": {
            mode: "dark",
            options: {
              material: { refraction: 800, transparency: null, quality: "ultra" },
              layout: { player: "__proto__" },
            },
          },
        },
      }),
    );
    expect(migrated.themeId).toBe("classic");
    expect(migrated.profiles.classic).toMatchObject({
      mode: "system",
      customColor: "#1a2",
      imageBackground: { blur: 0 },
    });
    expect(migrated.profiles["sakura-liquid"]).toMatchObject({
      mode: "dark",
      options: {
        material: { refraction: 100, transparency: 48, quality: "auto" },
        layout: { player: "liquid" },
      },
    });
  });

  it("切换及刷新后恢复各主题各自的颜色、全屏布局和动效", () => {
    localStorage.setItem("theme", JSON.stringify(legacy));
    setupPinia();
    const theme = useThemeStore();
    const settings = useSettingsStore();
    setActivePlayerLayout("apple");
    theme.themeId = "sakura-liquid";
    expect(activePlayerLayout()).toBe("liquid");
    setActivePlayerLayout("fullCover");
    theme.setCustomColor("#88cc22");
    theme.options.motion = "reduced";
    expect(settings.reducedMotion).toBe(true);
    theme.themeId = "classic";
    expect(settings.reducedMotion).toBe(false);
    expect(activePlayerLayout()).toBe("apple");
    expect(theme.customColor).toBe(legacy.customColor);
    theme.themeId = "sakura-liquid";
    theme.$persist();
    settings.$persist();

    const pinia = setupPinia();
    const reloaded = useThemeStore(pinia);
    expect(reloaded.themeId).toBe("sakura-liquid");
    expect(reloaded.customColor).toBe("#88cc22");
    expect(activePlayerLayout()).toBe("fullCover");
    reloaded.themeId = "classic";
    expect(activePlayerLayout()).toBe("apple");
    expect(reloaded.imageBackground).toEqual(legacy.imageBackground);
  });
});

describe("材质降级", () => {
  const supported = {
    backdrop: true,
    displacement: true,
    accelerated: true,
    highContrast: false,
    limitedDevice: false,
  };

  it("在自动与平衡档限制较慢设备的折射范围", () => {
    expect(resolveMaterial("auto", 70, supported)).toMatchObject({
      tier: "refraction",
      high: true,
    });
    expect(resolveMaterial("auto", 70, { ...supported, limitedDevice: true })).toMatchObject({
      tier: "refraction",
      high: false,
    });
    expect(resolveMaterial("balanced", 70, supported)).toMatchObject({
      tier: "refraction",
      high: false,
    });
  });

  it("遇到硬件、可读性、滤镜验证或能力限制时逐级回退", () => {
    expect(resolveMaterial("high", 70, { ...supported, accelerated: false }).tier).toBe("frosted");
    expect(resolveMaterial("auto", 70, { ...supported, displacement: false }).tier).toBe("frosted");
    expect(resolveMaterial("high", 70, { ...supported, svgFilterVerified: false }).tier).toBe(
      "frosted",
    );
    expect(resolveMaterial("auto", 0, supported).tier).toBe("frosted");
    expect(resolveMaterial("auto", 70, { ...supported, backdrop: false }).tier).toBe("opaque");
    expect(resolveMaterial("high", 70, { ...supported, highContrast: true }).tier).toBe("opaque");
    expect(resolveMaterial("low", 70, supported).tier).toBe("opaque");
  });
});

describe("平凸透镜位移图光学性质", () => {
  it("平直中心保持严格中性，四边沿法线向内折射且无折叠", () => {
    const cssWidth = 320;
    const cssHeight = 80;
    const pixels = createLensMapPixels(cssWidth, cssHeight, 24, true);
    const sample = (x: number, y: number) => {
      const i = (y * pixels.width + x) * 4;
      return {
        r: pixels.data[i],
        g: pixels.data[i + 1],
        b: pixels.data[i + 2],
        a: pixels.data[i + 3],
      };
    };

    const midX = Math.floor(pixels.width / 2);
    const midY = Math.floor(pixels.height / 2);
    expect(sample(midX, midY)).toEqual({ r: 128, g: 128, b: 0, a: 255 });

    // 四边边缘向中心采样：上边 G>128、下边 G<128、左边 R>128、右边 R<128
    expect(sample(midX, 0).g).toBeGreaterThan(220);
    expect(sample(midX, 0).r).toBe(128);
    expect(sample(midX, 0).b).toBeGreaterThan(200);
    expect(sample(midX, pixels.height - 1).g).toBeLessThan(36);
    expect(sample(0, midY).r).toBeGreaterThan(220);
    expect(sample(pixels.width - 1, midY).r).toBeLessThan(36);

    // 即使在最大 100% 折射强度下，从边缘到中心的采样坐标也必须严格单调递增，不发生倒像折叠
    const pixelY = cssHeight / pixels.height;
    let prevSampledY = -1;
    for (let y = 0; y <= midY; y++) {
      const cssY = (y + 0.5) * pixelY;
      const g = sample(midX, y).g;
      const sampledY = cssY + pixels.maxScale * (g / 255 - 0.5);
      expect(sampledY).toBeGreaterThanOrEqual(0);
      expect(sampledY).toBeGreaterThan(prevSampledY);
      prevSampledY = sampledY;
    }
  });

  it("小圆角斜边内侧法线连续过渡，不出现 45 度跳变接缝", () => {
    const pixels = createLensMapPixels(200, 80, 6, true);
    const sample = (x: number, y: number) => {
      const i = (y * pixels.width + x) * 4;
      return [pixels.data[i], pixels.data[i + 1]] as const;
    };
    let maxStep = 0;
    for (let y = 1; y < Math.floor(pixels.height / 2); y++) {
      for (let x = 1; x < Math.floor(pixels.width / 4); x++) {
        const [r, g] = sample(x, y);
        const [rx, gx] = sample(x - 1, y);
        const [ry, gy] = sample(x, y - 1);
        maxStep = Math.max(
          maxStep,
          Math.abs(r - rx),
          Math.abs(g - gx),
          Math.abs(r - ry),
          Math.abs(g - gy),
        );
      }
    }
    expect(maxStep).toBeLessThan(24);
  });
});
