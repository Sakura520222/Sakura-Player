import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanionDrag } from "./useCompanionDrag";

const beginDrag = vi.fn();
const endDrag = vi.fn<(cancelled: boolean) => Promise<boolean>>();
const moveBy = vi.fn();
const toggle = vi.fn();

/** 将手势处理器挂到真实按钮，保留页面级指针监听 */
function mountButton() {
  return mount(
    defineComponent({
      setup() {
        const drag = useCompanionDrag(toggle);
        return () =>
          h("button", {
            onPointerdown: drag.startDrag,
            onClick: drag.activate,
            onKeydown: drag.moveByKey,
            "data-dragging": drag.isDragging.value,
          });
      },
    }),
    { attachTo: document.body },
  );
}

describe("陪伴角色指针手势", () => {
  let wrapper: ReturnType<typeof mountButton>;
  let button: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    endDrag.mockResolvedValue(false);
    Object.assign(window, { api: { companion: { beginDrag, endDrag, moveBy } } });
    wrapper = mountButton();
    button = wrapper.element as HTMLElement;
    Object.assign(button, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
  });
  afterEach(() => {
    wrapper.unmount();
  });

  it("按下即捕获，普通松手只切换面板一次", async () => {
    await wrapper.trigger("pointerdown", { isPrimary: true, pointerId: 4, button: 0 });
    expect(button.setPointerCapture).toHaveBeenCalledWith(4);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 4 }));
    await wrapper.trigger("click", { detail: 1 });
    expect(endDrag).toHaveBeenCalledExactlyOnceWith(false);
    expect(button.releasePointerCapture).toHaveBeenCalledWith(4);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("上次松手的 IPC 尚未返回时再次轻点，两次有效点击都生效", async () => {
    const first = Promise.withResolvers<boolean>();
    endDrag.mockReturnValueOnce(first.promise);
    for (const pointerId of [4, 5]) {
      await wrapper.trigger("pointerdown", { isPrimary: true, pointerId, button: 0 });
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId }));
      await wrapper.trigger("click", { detail: 1 });
    }
    first.resolve(false);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("主进程尚未回传最终位移时不把松手解释为点击", async () => {
    const wait = Promise.withResolvers<boolean>();
    endDrag.mockReturnValue(wait.promise);
    await wrapper.trigger("pointerdown", { isPrimary: true, pointerId: 4, button: 0 });
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 4 }));
    await wrapper.trigger("click", { detail: 1 });
    expect(toggle).not.toHaveBeenCalled();
    wait.resolve(true);
    await wait.promise;
    expect(toggle).not.toHaveBeenCalled();
    await wrapper.trigger("keydown", { key: "ArrowLeft", shiftKey: true });
    expect(moveBy).toHaveBeenCalledExactlyOnceWith(-48, 0);
    await wrapper.trigger("click", { detail: 0 });
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("移出按钮后显示拖动状态，取消或重复释放不切换面板", async () => {
    await wrapper.trigger("pointerdown", {
      isPrimary: true,
      pointerId: 4,
      button: 0,
      screenX: 10,
      screenY: 10,
    });
    window.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 4, screenX: 32, screenY: 10 }),
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes("data-dragging")).toBe("true");
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 4 }));
    window.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 4 }));
    await wrapper.trigger("click", { detail: 1 });
    expect(endDrag).toHaveBeenCalledExactlyOnceWith(true);
    expect(toggle).not.toHaveBeenCalled();
  });
});
