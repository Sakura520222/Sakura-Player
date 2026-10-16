import { afterEach, describe, expect, it, vi } from "vitest";
import { TimedAuxiliaryRenderer } from "./timedAuxiliary";

afterEach(() => {
  document.body.replaceChildren();
});

describe("辅助歌词高亮生命周期", () => {
  it("虚拟化清空副行时不恢复旧文本，重新进入视口后恢复对齐", async () => {
    const container = document.createElement("div"),
      element = document.createElement("div");
    element.textContent = "译文";
    container.appendChild(element);
    document.body.appendChild(container);
    const words = [{ word: "译文", startTime: 1000, endTime: 2000 }];
    const renderer = new TimedAuxiliaryRenderer(container, () => [{ element, words }]);
    element.textContent = "";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.textContent).toBe("");
    expect(element.classList.contains("timed-auxiliary")).toBe(false);
    element.textContent = "译文";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.querySelectorAll("[data-aux-word]")).toHaveLength(1);
    renderer.dispose();
  });
  it("沿用主歌词推送时间、响应显隐设置且不启动新的动画循环", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const container = document.createElement("div"),
      element = document.createElement("div");
    element.textContent = "<script>安全文本";
    container.appendChild(element);
    document.body.appendChild(container);
    let enabled = true;
    const words = [
      { word: "<script>", startTime: 1000, endTime: 1500 },
      { word: "安全文本", startTime: 1700, endTime: 3000 },
    ];
    const renderer = new TimedAuxiliaryRenderer(container, () =>
      enabled ? [{ element, words }] : [],
    );
    renderer.setCurrentTime(1250);
    expect(container.style.getPropertyValue("--lyric-aux-time")).toBe("1250");
    expect(element.querySelectorAll("[data-aux-word]")).toHaveLength(2);
    expect(element.querySelector("script")).toBeNull();
    expect(raf).not.toHaveBeenCalled();
    enabled = false;
    renderer.refresh();
    expect(container.style.getPropertyValue("--lyric-aux-time")).toBe("");
    expect(element.textContent).toBe("<script>安全文本");
    expect(element.querySelector("[data-aux-word]")).toBeNull();
    enabled = true;
    renderer.refresh();
    renderer.setCurrentTime(900);
    expect(container.style.getPropertyValue("--lyric-aux-time")).toBe("900");
    renderer.dispose();
    expect(element.textContent).toBe("<script>安全文本");
    expect(element.querySelector("[data-aux-word]")).toBeNull();
    expect(element.classList.contains("timed-auxiliary")).toBe(false);
    element.textContent = "changed";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.querySelector("[data-aux-word]")).toBeNull();
    expect(container.style.getPropertyValue("--lyric-aux-time")).toBe("");
  });
});
