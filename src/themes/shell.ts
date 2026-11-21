// @unocss-include 主题策略提供的工具类需进入生产样式表
import type { LayoutMode } from "@/types/settings";

export interface ShellState {
  hasTrack: boolean;
  collapsed: boolean;
  expanded: boolean;
  layout: LayoutMode;
}

/** 稳定的布局槽位，主题切换时保留路由、导航和播放控件实例 */
export interface ShellRegions {
  root: string;
  sidebar: string;
  workspace: string;
  header: string;
  dockPosition: string;
  dockSurface: string;
}

/**
 * 计算经典界面各槽位，沿用现有布局模式
 * @param state - 当前窗口与播放布局状态
 * @returns 经典主题区域样式
 */
export function classicShell({ layout, collapsed, hasTrack, expanded }: ShellState): ShellRegions {
  const floating = layout === "floating";
  const dock = "fixed bottom-0 z-50 transition-[left] duration-300 pointer-events-none";
  return {
    root: "h-screen flex overflow-hidden bg-app",
    sidebar: [
      "shrink-0 bg-surface-panel overflow-y-auto z-10 transition-[width,margin] duration-300",
      collapsed ? "w-16" : "w-60",
      floating
        ? "ml-3 mt-3 mb-3 rounded-xl border border-solid border-primary/10"
        : "border-r border-r-solid border-r-primary/10",
      hasTrack && layout === "default" ? "mb-20" : "",
    ].join(" "),
    workspace: hasTrack && !floating ? "mb-20" : "",
    header: "h-16 shrink-0 flex items-center px-3",
    dockPosition: [
      dock,
      layout === "sidebar-full"
        ? collapsed
          ? "left-16 right-0"
          : "left-60 right-0"
        : floating
          ? `${collapsed ? "left-[76px]" : "left-[252px]"} right-0 px-4 pb-6`
          : "left-0 right-0",
    ].join(" "),
    dockSurface: [
      expanded ? "pointer-events-none" : "pointer-events-auto",
      floating
        ? "mx-auto max-w-4xl glass-panel rounded-full shadow-xl border border-solid border-primary/10"
        : "h-20 bg-surface-panel border-t border-t-solid border-t-primary/10",
    ].join(" "),
  };
}

/**
 * 布置 Liquid 的导航轨、内容舞台与独立播放 Dock
 * @param state - 当前窗口与播放布局状态
 * @returns Liquid 主题区域样式
 */
export function liquidShell({ collapsed, hasTrack, expanded }: ShellState): ShellRegions {
  return {
    root: `liquid-shell ${collapsed ? "liquid-shell-narrow" : ""}`,
    sidebar: "liquid-rail liquid-pane",
    workspace: hasTrack ? "liquid-workspace-with-dock" : "liquid-workspace",
    header: "liquid-command-bar liquid-pane",
    dockPosition: `liquid-dock-position ${collapsed ? "liquid-dock-position-narrow" : ""}`,
    dockSurface: `liquid-dock liquid-pane ${expanded ? "pointer-events-none" : "pointer-events-auto"}`,
  };
}
