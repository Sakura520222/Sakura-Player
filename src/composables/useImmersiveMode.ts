import type { Ref } from "vue";
import { useSettingsStore } from "@/stores/settings";

/** 沉浸模式闲置时间（ms） */
const IMMERSIVE_IDLE_MS = 3000;
const PLAYER_BARS = '[data-player-layout="top-bar"], [data-player-layout="bottom-bar"]';

/**
 * 全屏播放器沉浸模式
 * 闲置指定时间后自动隐藏顶栏/底栏，鼠标移动时恢复
 * @param isPlayerExpanded - 播放器是否展开
 */
export const useImmersiveMode = (isPlayerExpanded: Ref<boolean>) => {
  const settings = useSettingsStore();

  const immersive = ref(false);
  const barHovered = ref(false);
  const controlMenuOpen = ref(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const enabled = computed(() => settings.player.autoImmersive && isPlayerExpanded.value);

  /** 键盘操作期间保留获得焦点的工具栏 */
  const hasKeyboardFocus = (): boolean =>
    !!document.activeElement?.matches(":focus-visible") &&
    !!document.activeElement.closest(PLAYER_BARS);

  /** 重新显示工具栏并安排下一次沉浸隐藏 */
  const armIdle = (): void => {
    clearTimeout(idleTimer);
    immersive.value = false;
    if (!enabled.value || controlMenuOpen.value) return;
    idleTimer = setTimeout(() => {
      if (!barHovered.value && !hasKeyboardFocus()) immersive.value = true;
    }, IMMERSIVE_IDLE_MS);
  };

  const onPlayerMouseEnter = (): void => armIdle();

  /**
   * 离开窗口时隐藏控制栏，进入窗口内的传送弹层时重新计时
   * @param event - 当前鼠标离开事件
   */
  const onPlayerMouseLeave = (event: MouseEvent): void => {
    if (controlMenuOpen.value || hasKeyboardFocus()) return;
    if (
      event.relatedTarget instanceof Node &&
      document.documentElement.contains(event.relatedTarget)
    ) {
      armIdle();
      return;
    }
    clearTimeout(idleTimer);
    if (enabled.value) immersive.value = true;
  };

  const onMainMove = (): void => {
    if (!barHovered.value) armIdle();
  };

  const onBarEnter = (): void => {
    barHovered.value = true;
    clearTimeout(idleTimer);
    immersive.value = false;
  };

  const onBarLeave = (): void => {
    barHovered.value = false;
    armIdle();
  };

  /**
   * 键盘聚焦时立即显示控件，离开工具栏后恢复闲置计时
   * @param event - 播放器内部的焦点事件
   */
  const onBarFocusChange = (event: FocusEvent): void => {
    if (event.target instanceof Element && event.target.closest(PLAYER_BARS)) armIdle();
  };

  /**
   * 菜单交互期间保持控制栏可操作，关闭后重新开始闲置计时
   * @param open - 控制栏菜单是否打开
   */
  const setControlMenuOpen = (open: boolean): void => {
    if (controlMenuOpen.value === open) return;
    controlMenuOpen.value = open;
    armIdle();
  };

  watch(enabled, (on) => {
    if (!on) {
      clearTimeout(idleTimer);
      immersive.value = false;
      barHovered.value = false;
    }
  });

  onBeforeUnmount(() => clearTimeout(idleTimer));

  return {
    immersive,
    onPlayerMouseEnter,
    onPlayerMouseLeave,
    onMainMove,
    onBarEnter,
    onBarLeave,
    onBarFocusChange,
    controlMenuOpen,
    setControlMenuOpen,
  };
};
