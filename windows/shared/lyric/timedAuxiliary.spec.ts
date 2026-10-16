import { afterEach, describe, expect, it, vi } from "vitest";
import { TimedAuxiliaryRenderer } from "./timedAuxiliary";

afterEach(() => {
  document.body.replaceChildren();
});

describe("辅助歌词高亮生命周期", () => {
  it("长歌词播放时只更新活动字词，已唱与未来行不发生逐帧样式写入", () => {
    const container = document.createElement("div");
    const targets = Array.from({ length: 300 }, (_, index) => {
      const element = document.createElement("div");
      element.textContent = "译文";
      container.appendChild(element);
      return {
        element,
        words: [{ word: "译文", startTime: index * 5000, endTime: index * 5000 + 4000 }],
      };
    });
    document.body.appendChild(container);
    const renderer = new TimedAuxiliaryRenderer(container, () => targets);
    renderer.setCurrentTime(20000);
    const spans = targets.map((target) => target.element.firstElementChild as HTMLElement);
    const writes = spans.map((span) => vi.spyOn(span.style, "setProperty"));
    const rootWrites = vi.spyOn(container.style, "setProperty");
    for (let time = 20100; time < 21000; time += 16) renderer.setCurrentTime(time);
    expect(writes[4]).toHaveBeenCalled();
    expect(
      writes.filter((_, index) => index !== 4).every((spy) => spy.mock.calls.length === 0),
    ).toBe(true);
    expect(rootWrites).not.toHaveBeenCalled();
    expect(spans[3].dataset.auxState).toBe("played");
    expect(spans[5].dataset.auxState).toBe("unplayed");
    renderer.dispose();
  });

  it("已存在的逆序译文按左到右推进，前后跳转和切句均即时校准", () => {
    const container = document.createElement("div"),
      element = document.createElement("div");
    element.textContent = "甲乙";
    container.appendChild(element);
    document.body.appendChild(container);
    const renderer = new TimedAuxiliaryRenderer(container, () => [
      {
        element,
        words: [
          { word: "甲", startTime: 2000, endTime: 3000 },
          { word: "乙", startTime: 1000, endTime: 2000 },
        ],
      },
    ]);
    renderer.setCurrentTime(1500);
    expect(Array.from(element.children, (word) => (word as HTMLElement).dataset.auxState)).toEqual([
      "active",
      "unplayed",
    ]);
    renderer.setCurrentTime(2500);
    expect(Array.from(element.children, (word) => (word as HTMLElement).dataset.auxState)).toEqual([
      "played",
      "active",
    ]);
    renderer.setCurrentTime(4000);
    expect(Array.from(element.children, (word) => (word as HTMLElement).dataset.auxState)).toEqual([
      "played",
      "played",
    ]);
    renderer.setCurrentTime(500);
    expect(Array.from(element.children, (word) => (word as HTMLElement).dataset.auxState)).toEqual([
      "unplayed",
      "unplayed",
    ]);
    renderer.setCurrentTime(2500);
    expect((element.children[1] as HTMLElement).style.getPropertyValue("--aux-progress")).toBe(
      "0.5",
    );
    renderer.dispose();
  });

  it("音译时间保留与原字词的重叠关系，不套用译文的顺排规则", () => {
    const container = document.createElement("div"),
      element = document.createElement("div");
    element.textContent = "ab";
    container.appendChild(element);
    document.body.appendChild(container);
    const renderer = new TimedAuxiliaryRenderer(container, () => [
      {
        element,
        kind: "romanization",
        words: [
          { word: "a", startTime: 1000, endTime: 3000 },
          { word: "b", startTime: 1500, endTime: 3000 },
        ],
      },
    ]);
    renderer.setCurrentTime(2000);
    expect(Array.from(element.children, (word) => (word as HTMLElement).dataset.auxState)).toEqual([
      "active",
      "active",
    ]);
    renderer.dispose();
  });

  it("移除活动副行后释放事件与节点，重建时用当前时间恢复", async () => {
    const container = document.createElement("div"),
      element = document.createElement("div");
    element.textContent = "译文";
    container.appendChild(element);
    document.body.appendChild(container);
    const words = [{ word: "译文", startTime: 1000, endTime: 3000 }];
    const renderer = new TimedAuxiliaryRenderer(container, () => [{ element, words }]);
    renderer.setCurrentTime(1500);
    const old = element.firstElementChild as HTMLElement;
    const writes = vi.spyOn(old.style, "setProperty");
    element.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderer.setCurrentTime(2000);
    expect(writes).not.toHaveBeenCalled();
    container.appendChild(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((element.firstElementChild as HTMLElement).dataset.auxState).toBe("active");
    expect(
      (element.firstElementChild as HTMLElement).style.getPropertyValue("--aux-progress"),
    ).toBe("0.5");
    renderer.dispose();
  });
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
    expect(container.style.getPropertyValue("--lyric-aux-time")).toBe("");
    expect(element.children[0].getAttribute("data-aux-state")).toBe("active");
    expect((element.children[0] as HTMLElement).style.getPropertyValue("--aux-progress")).toBe(
      "0.5",
    );
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
    expect(container.style.getPropertyValue("--lyric-aux-time")).toBe("");
    expect(element.children[0].getAttribute("data-aux-state")).toBe("unplayed");
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
