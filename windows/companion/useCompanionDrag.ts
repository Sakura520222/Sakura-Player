/**
 * 捕获角色指针，将整次拖动交给主进程跟随系统光标
 * @param togglePanel - 普通单击和键盘激活时的面板切换
 * @param onDragDelta - 拖动期间的指针步进位移回调，用于驱动惯性摇摆
 * @returns 按钮的按下、激活和方向键处理器以及拖动状态
 */
export function useCompanionDrag(
  togglePanel: () => void,
  onDragDelta?: (dx: number, dy: number) => void,
) {
  const api = window.api.companion;
  const isDragging = ref(false);
  let pointer:
    | { id: number; button: HTMLElement; x: number; y: number; lastX: number; lastY: number }
    | undefined;
  let released: Promise<boolean> | undefined;
  let disposed = false;

  /**
   * 在按下按钮时立即捕获指针，移出按钮或原窗口仍能处理松手
   * @param event - 角色按钮收到的原始指针事件
   */
  function startDrag(event: PointerEvent): void {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      pointer ||
      !(event.currentTarget instanceof HTMLElement)
    )
      return;
    released = undefined;
    const button = event.currentTarget;
    button.setPointerCapture(event.pointerId);
    pointer = {
      id: event.pointerId,
      button,
      x: event.screenX,
      y: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
    };
    api.beginDrag();
  }

  /**
   * 只在本地更新拖动外观与惯性增量，实际窗口位置由系统光标驱动
   * @param event - 捕获的指针移动
   */
  function move(event: PointerEvent): void {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!isDragging.value) {
      if (Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) < 5) return;
      isDragging.value = true;
    }
    const dx = event.screenX - pointer.lastX;
    const dy = event.screenY - pointer.lastY;
    pointer.lastX = event.screenX;
    pointer.lastY = event.screenY;
    if (dx || dy) onDragDelta?.(dx, dy);
  }

  /**
   * 释放指针，并记住这次手势是否已移动或取消
   * @param cancelled - 是否放弃拖动
   */
  function finish(cancelled: boolean): void {
    if (!pointer) return;
    const { id, button } = pointer;
    pointer = undefined;
    if (button.hasPointerCapture(id)) button.releasePointerCapture(id);
    const suppress = cancelled || isDragging.value;
    isDragging.value = false;
    released = api.endDrag(cancelled).then(
      (moved) => moved || suppress,
      () => true,
    );
  }

  /**
   * 单独识别松手和指针取消，忽略其他指针的不相关事件
   * @param event - 完成手势的指针事件
   */
  function release(event: PointerEvent): void {
    if (pointer?.id === event.pointerId) finish(event.type !== "pointerup");
  }

  /** 窗口失去焦点或卸载时释放正在进行的拖动 */
  function cancel(): void {
    finish(true);
  }

  /**
   * 避免拖动释放后的合成 click 打开面板，保留键盘生成的点击
   * @param event - 角色按钮点击
   */
  async function activate(event: MouseEvent): Promise<void> {
    if (event.detail !== 0 && released && (await released)) return;
    if (!disposed) togglePanel();
  }

  /**
   * 通过方向键移动并保存角色落点
   * @param event - 角色按钮收到的键盘事件
   */
  function moveByKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const step = event.shiftKey ? 48 : 12;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    api.moveBy(dx, dy);
  }

  onMounted(() => {
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("lostpointercapture", release);
    window.addEventListener("blur", cancel);
  });
  onBeforeUnmount(() => {
    disposed = true;
    cancel();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    window.removeEventListener("lostpointercapture", release);
    window.removeEventListener("blur", cancel);
  });
  return { startDrag, activate, moveByKey, isDragging: readonly(isDragging) };
}
