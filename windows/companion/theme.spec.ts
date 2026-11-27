import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanionApi, CompanionTheme } from "@shared/types/companion";
import { companionReducedMotion, syncCompanionTheme } from "./theme";

const classic: CompanionTheme = {
  theme: "classic",
  material: "standard",
  motion: "standard",
  tier: "opaque",
  appearance: "solid",
  dark: false,
  reducedMotion: false,
  variables: { "--s-primary": "63 34 63" },
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("class");
  for (const key of Object.keys(document.documentElement.dataset)) {
    delete document.documentElement.dataset[key];
  }
});

describe("独立窗口的主题同步", () => {
  it("先到达的新主题覆盖启动快照，切换后撤销旧材质和动效偏好", async () => {
    let snapshot!: (value: CompanionTheme | null) => void;
    let receive!: (value: CompanionTheme) => void;
    const unsubscribe = vi.fn();
    const api = {
      getTheme: () => new Promise<CompanionTheme | null>((resolve) => (snapshot = resolve)),
      onTheme: (callback) => {
        receive = callback;
        return unsubscribe;
      },
    } satisfies Pick<CompanionApi, "getTheme" | "onTheme">;
    vi.stubGlobal("api", { companion: api });
    const media = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", () => media);
    const mount = vi.fn();
    const stop = syncCompanionTheme(mount);
    const root = document.documentElement;
    const liquid: CompanionTheme = {
      ...classic,
      theme: "sakura-liquid",
      material: "liquid",
      motion: "liquid",
      tier: "frosted",
      dark: true,
      reducedMotion: true,
      variables: { "--s-primary": "225 183 170", "--liquid-radius": "24px" },
    };
    receive(liquid);
    snapshot(classic);
    await Promise.resolve();
    expect(root.dataset.theme).toBe("sakura-liquid");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    expect(companionReducedMotion.value).toBe(true);
    expect(root.style.getPropertyValue("--liquid-radius")).toBe("24px");
    receive(classic);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(root.style.colorScheme).toBe("light");
    expect(root.style.getPropertyValue("--liquid-radius")).toBe("");
    expect(root.style.getPropertyValue("--s-primary")).toBe("63 34 63");
    expect(root.hasAttribute("data-reduced-motion")).toBe(false);
    media.matches = true;
    media.dispatchEvent(new Event("change"));
    expect(companionReducedMotion.value).toBe(true);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    media.matches = false;
    media.dispatchEvent(new Event("change"));
    expect(companionReducedMotion.value).toBe(true);
  });

  it("窗口先关闭时忽略尚未返回的首屏快照", async () => {
    const mount = vi.fn();
    const theme = Promise.resolve(classic);
    vi.stubGlobal("api", { companion: { getTheme: () => theme, onTheme: () => vi.fn() } });
    const stop = syncCompanionTheme(mount);
    stop();
    await theme;
    expect(mount).not.toHaveBeenCalled();
  });
});
