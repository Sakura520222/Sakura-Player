import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { describe, it, expect, vi } from "vitest";
import { hasFftSubscribers, isFftSubscriber, subscribeFft } from "./fftSubscriptions";
import { setFftEnabled } from "./engine";

vi.mock("./engine", () => ({ setFftEnabled: vi.fn() }));

describe("多窗口频谱订阅", () => {
  it("窗口重载或关闭时只移除自己的订阅", () => {
    const main = new EventEmitter() as WebContents;
    const pet = new EventEmitter() as WebContents;
    subscribeFft(main, true);
    subscribeFft(main, true);
    subscribeFft(pet, true);
    expect(setFftEnabled).toHaveBeenCalledTimes(1);
    main.emit("did-start-loading");
    main.emit("did-navigate-in-page", {}, "file://player/#/library", true);
    main.emit("did-frame-navigate", {}, "about:blank", -1, "", false);
    expect(isFftSubscriber(main)).toBe(true);
    main.emit("did-navigate");
    expect(isFftSubscriber(main)).toBe(false);
    expect(hasFftSubscribers()).toBe(true);
    pet.emit("destroyed");
    expect(setFftEnabled).toHaveBeenLastCalledWith(false);
    expect(hasFftSubscribers()).toBe(false);
    expect(pet.listenerCount("render-process-gone")).toBe(0);
    const dead = Object.assign(new EventEmitter(), { isDestroyed: () => true }) as WebContents;
    subscribeFft(dead, true);
    expect(isFftSubscriber(dead)).toBe(false);
    expect(hasFftSubscribers()).toBe(false);
  });
});
