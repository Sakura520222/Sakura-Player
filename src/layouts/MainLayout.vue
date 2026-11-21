<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { materialKey } from "@/themes/material";
import { useOrpheusProtocol } from "@/composables/useOrpheusProtocol";
import { useExternalFileHandler } from "@/composables/useExternalFileHandler";
import { useResponsiveLayout } from "@/composables/useResponsiveLayout";
import { coverTransitionActive, installCoverTransitions } from "@/services/coverTransition";
import {
  fullPlayerReady,
  playerTransitionActive,
  cancelPlayerTransition,
} from "@/services/playerTransition";

const route = useRoute();
const router = useRouter();
const status = useStatusStore();
const settings = useSettingsStore();
const theme = useThemeStore();
const documentVisibility = useDocumentVisibility();
const themeMaterial = inject(materialKey);
const visibility = computed(
  () => themeMaterial?.value.visible ?? documentVisibility.value === "visible",
);
const { sidebarCollapsed } = useResponsiveLayout();

// 接入 orpheus 协议唤起与外部音频文件播放
useOrpheusProtocol();
useExternalFileHandler();

/** 有歌曲信息时显示播放栏 */
const showPlayerBar = computed(() => !!useMediaStore().track);
const { isPlayerExpanded } = storeToRefs(status);

/** 播放页展开状态同步与懒加载 */
const FullPlayer = defineAsyncComponent(() => import("@/components/player/FullPlayer/index.vue"));
const fullPlayerLoaded = ref(isPlayerExpanded.value);
watch(
  isPlayerExpanded,
  (expanded) => {
    if (expanded) fullPlayerLoaded.value = true;
    window.api.window.setPlayerExpanded(expanded);
  },
  { immediate: true },
);

const { appearance } = settings;

/** 路由切换动效 */
const routeTransitionName = computed(() => {
  const transition = appearance.routeTransition;
  return theme.definition.motion.route ?? (transition === "none" ? "" : `route-${transition}`);
});

/** 详情按路径和服务器隔离实例，列表沿用父路由缓存 */
const routeKey = computed(() => {
  const hasParam = route.matched.some((m) => m.path.includes(":"));
  return hasParam
    ? `${route.path}:${route.query.serverId ?? ""}`
    : (route.matched[1]?.path ?? route.path);
});

/** 需要受控缓存的页面组件白名单 */
const cachedViews = [
  "Home",
  "Library",
  "Liked",
  "History",
  "Download",
  "Daily",
  "Favorites",
  "Cloud",
  "LocalList",
  "Folders",
  "SearchPage",
  "Stats",
  "StreamingIndex",
];

const mainContainerRef = shallowRef<HTMLElement | null>(null);
const mainScrollMap = new Map<string, number>();

// 路由离开前记录滚动位置
watch(
  () => route.fullPath,
  (_newPath, oldPath) => {
    if (oldPath && mainContainerRef.value) {
      mainScrollMap.set(oldPath, mainContainerRef.value.scrollTop);
      if (mainScrollMap.size > 10) {
        mainScrollMap.delete(mainScrollMap.keys().next().value!);
      }
    }
  },
);

/** 路由切换完成后恢复主内容区滚动位置 */
const handleAfterEnter = (): void => {
  if (!mainContainerRef.value) return;
  const saved = mainScrollMap.get(route.fullPath) ?? 0;
  mainContainerRef.value.scrollTop = saved;
};

let disposeCoverTransitions: (() => void) | undefined;
watch(
  [
    () => theme.themeId,
    () =>
      (appearance.seamlessTransition || theme.definition.motion.sharedCover) &&
      !settings.reducedMotion,
    visibility,
  ],
  ([themeId, enabled, visible], previous) => {
    if (!enabled || !visible || themeId !== previous?.[0]) cancelPlayerTransition();
    disposeCoverTransitions?.();
    disposeCoverTransitions =
      enabled && visible
        ? installCoverTransitions(router, () => mainContainerRef.value, handleAfterEnter)
        : undefined;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  window.api.window.setPlayerExpanded(false);
  disposeCoverTransitions?.();
  cancelPlayerTransition();
  fullPlayerReady.value = false;
});

/** 计算当前主题的布局槽位 */
const shell = computed(() =>
  theme.definition.shell({
    layout: appearance.layoutMode,
    collapsed: sidebarCollapsed.value,
    hasTrack: showPlayerBar.value,
    expanded: isPlayerExpanded.value,
  }),
);
const lens = computed(() => theme.definition.material.lens);
const chrome = computed(() => theme.definition.chrome);
</script>

<template>
  <!-- 主界面 -->
  <div
    class="player-shell text-on-surface transition-[transform,opacity] duration-360 ease-[cubic-bezier(0.25,1,0.35,1)] origin-center"
    :style="playerTransitionActive ? { transition: 'none' } : undefined"
    :inert="isPlayerExpanded && fullPlayerReady"
    :class="[
      shell.root,
      isPlayerExpanded && fullPlayerReady ? 'scale-95 opacity-0 pointer-events-none' : '',
    ]"
  >
    <!-- 侧边栏 -->
    <aside :class="shell.sidebar">
      <component :is="lens" v-if="lens" :inactive="isPlayerExpanded" />
      <component :is="chrome.sidebar" v-if="chrome?.sidebar" />
      <SideBar v-else />
    </aside>

    <!-- 右侧主区域 -->
    <div class="flex-1 flex flex-col min-w-0 min-h-0" :class="shell.workspace">
      <!-- 顶部导航 -->
      <header :class="shell.header">
        <component :is="lens" v-if="lens" priority :inactive="isPlayerExpanded" />
        <component :is="chrome.navigation" v-if="chrome?.navigation" />
        <NavHeader v-else />
      </header>

      <!-- 主内容区 -->
      <main ref="mainContainerRef" class="flex-1 overflow-y-auto overflow-x-hidden">
        <RouterView v-slot="{ Component }">
          <Transition
            :name="routeTransitionName"
            :css="!coverTransitionActive"
            :mode="coverTransitionActive ? undefined : 'out-in'"
            @after-enter="handleAfterEnter"
          >
            <KeepAlive :max="10" :include="cachedViews">
              <component :is="Component" :key="routeKey" />
            </KeepAlive>
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>

  <!-- 底部播放栏 -->
  <Transition v-bind="theme.definition.motion.dock">
    <div v-if="showPlayerBar" :class="shell.dockPosition">
      <footer :class="shell.dockSurface" :inert="isPlayerExpanded">
        <component :is="lens" v-if="lens" priority :inactive="isPlayerExpanded" />
        <component :is="chrome.dock" v-if="chrome?.dock" />
        <PlayerBar v-else />
      </footer>
    </div>
  </Transition>

  <!-- Toast -->
  <SToast :max="1" />
  <!-- 性能监视器 -->
  <SPerformanceMonitor v-if="appearance.showPerformanceMonitor" />
  <!-- Dialog -->
  <SDialogProvider />
  <!-- 全屏播放器 -->
  <FullPlayer v-if="fullPlayerLoaded" />
  <!-- 全局设置 -->
  <SettingsDialog />
  <!-- 更新弹窗 -->
  <UpdateDialog />
  <!-- 评论弹窗 -->
  <MusicCommentsDialog />
  <!-- 输出信息弹窗 -->
  <AudioInfoDialog />
</template>
