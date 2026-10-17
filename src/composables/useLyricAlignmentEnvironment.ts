import type { Ref } from "vue";
import type { AlignmentEnvironmentState } from "@shared/types/lyricAlignment";

/**
 * 订阅专用环境状态，安装和卸载仅由界面点击触发
 * @param open - 弹窗是否可见
 * @returns 环境状态和显式安装、取消、卸载操作
 */
export const useLyricAlignmentEnvironment = (open: Ref<boolean>) => {
  const status = shallowRef<AlignmentEnvironmentState>({
    revision: -1,
    phase: "not-installed",
    installed: false,
    hasFiles: false,
    supported: true,
    inUse: false,
    downloadedBytes: 0,
    totalBytes: 0,
    detail: "",
    error: "",
  });
  const loading = ref(true);
  const actionPending = ref(false);
  const error = ref("");
  let disposed = false;
  const installing = computed(
    () => !["not-installed", "ready", "error", "uninstalling"].includes(status.value.phase),
  );
  const busy = computed(
    () => actionPending.value || installing.value || status.value.phase === "uninstalling",
  );
  const ready = computed(
    () => !loading.value && status.value.installed && status.value.phase === "ready",
  );
  const canInstall = computed(
    () =>
      !loading.value &&
      !busy.value &&
      !status.value.inUse &&
      !status.value.installed &&
      status.value.supported,
  );
  const canUninstall = computed(
    () => !loading.value && !busy.value && !status.value.inUse && status.value.hasFiles,
  );
  const progress = computed(() =>
    status.value.totalBytes > 0
      ? Math.min(100, Math.round((status.value.downloadedBytes / status.value.totalBytes) * 100))
      : null,
  );

  /**
   * 忽略晚于推送返回的旧快照，避免进度倒退
   * @param next - 主进程带版本号的环境状态
   */
  const update = (next: AlignmentEnvironmentState): void => {
    if (!disposed && next.revision >= status.value.revision) status.value = next;
  };

  /** 打开弹窗或窗口重新可见时读取最新状态，不启动安装 */
  const refresh = async (): Promise<void> => {
    if (disposed || !open.value) return;
    loading.value = true;
    try {
      update(await window.api.lyricAlignment.environmentStatus());
      if (!disposed) error.value = "";
    } catch (failure) {
      if (!disposed) error.value = failure instanceof Error ? failure.message : String(failure);
    } finally {
      if (!disposed) loading.value = false;
    }
  };

  /** 用户点击安装后等待完成，关闭弹窗不会中断后台安装 */
  const install = async (): Promise<void> => {
    if (!canInstall.value) return;
    actionPending.value = true;
    error.value = "";
    try {
      update(await window.api.lyricAlignment.installEnvironment());
    } catch (failure) {
      if (!disposed) error.value = failure instanceof Error ? failure.message : String(failure);
    } finally {
      if (!disposed) actionPending.value = false;
    }
  };

  /** 用户取消安装后由主进程回收进程和部分文件 */
  const cancelInstall = async (): Promise<void> => {
    if (!installing.value || status.value.phase === "cancelling") return;
    try {
      await window.api.lyricAlignment.cancelEnvironmentInstall();
    } catch (failure) {
      if (!disposed) error.value = failure instanceof Error ? failure.message : String(failure);
    }
  };

  /** 用户点击卸载时仅移除专用环境，后台使用权会阻止并发删除 */
  const uninstall = async (): Promise<void> => {
    if (!canUninstall.value) return;
    actionPending.value = true;
    error.value = "";
    try {
      update(await window.api.lyricAlignment.uninstallEnvironment());
    } catch (failure) {
      if (!disposed) error.value = failure instanceof Error ? failure.message : String(failure);
    } finally {
      if (!disposed) actionPending.value = false;
    }
  };

  const unsubscribe = window.api.lyricAlignment.onEnvironmentStatus(update);
  useEventListener(document, "visibilitychange", () => {
    if (!document.hidden) void refresh();
  });
  watch(
    open,
    (visible) => {
      if (visible) void refresh();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    disposed = true;
    unsubscribe();
  });
  return {
    status,
    loading,
    error,
    busy,
    installing,
    ready,
    canInstall,
    canUninstall,
    progress,
    install,
    cancelInstall,
    uninstall,
  };
};
