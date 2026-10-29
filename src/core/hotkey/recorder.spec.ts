import { afterEach, describe, expect, it, vi } from "vitest";
import { useHotkeyRecorder } from "./recorder";

let recorder: ReturnType<typeof useHotkeyRecorder> | undefined;

afterEach(() => {
  recorder?.cancel();
  recorder = undefined;
});

describe("快捷键录入", () => {
  it("Esc 取消录入并恢复全局快捷键，不保存 Escape", () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    const changed = vi.fn();
    recorder = useHotkeyRecorder({
      isMac: false,
      onConfirm: confirm,
      onCancel: cancel,
      onRecordingChange: changed,
    });
    recorder.start();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(recorder.isRecording.value).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(changed.mock.calls).toEqual([[true], [false]]);
  });

  it.each([
    ["Escape", "CommandOrControl+Escape"],
    ["Numpad7", "CommandOrControl+num7"],
    ["NumpadAdd", "CommandOrControl+numadd"],
    ["NumpadEnter", "CommandOrControl+Return"],
  ])("带修饰键的 %s 正确录入为 %s", (code, expected) => {
    const confirm = vi.fn();
    recorder = useHotkeyRecorder({ isMac: false, requireModifier: true, onConfirm: confirm });
    recorder.start();
    window.dispatchEvent(new KeyboardEvent("keydown", { code, ctrlKey: true }));
    expect(confirm).toHaveBeenCalledWith(expected);
    expect(recorder.isRecording.value).toBe(false);
  });

  it("失焦取消录入，重复启动和取消不会重复切换全局注册", () => {
    const changed = vi.fn();
    recorder = useHotkeyRecorder({ isMac: false, onConfirm: vi.fn(), onRecordingChange: changed });
    recorder.start();
    recorder.start();
    window.dispatchEvent(new Event("blur"));
    recorder.cancel();
    expect(changed.mock.calls).toEqual([[true], [false]]);
  });
});
