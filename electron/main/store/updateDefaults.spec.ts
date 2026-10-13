import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  version: "1.2.0-beta.1",
  raw: {} as Record<string, unknown>,
  write: vi.fn(),
  on: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getVersion: () => mocks.version, on: mocks.on },
}));
vi.mock("node:fs", () => ({
  default: {
    readFileSync: () => JSON.stringify(mocks.raw),
    existsSync: () => true,
  },
}));
vi.mock("atomically", () => ({ writeFileSync: mocks.write }));
vi.mock("@main/utils/paths", () => ({ configDir: "test-config" }));

describe("安装版本的默认更新通道", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.version = "1.2.0-beta.1";
    mocks.raw = {};
  });

  it.each([
    ["1.2.0-beta.1", "beta"],
    ["1.2.0", "stable"],
    ["1.2.0-alpha.1", "alpha"],
    ["1.2.0-nightly.100", "nightly"],
  ])("新安装 %s 默认跟踪 %s 并落盘", async (version, channel) => {
    mocks.version = version;
    const { store } = await import("./index");
    expect(store.get("update.channel")).toBe(channel);
    expect(JSON.parse(mocks.write.mock.calls.at(-1)![1]).update.channel).toBe(channel);
  });

  it.each(["stable", "beta", "alpha", "nightly"])(
    "启动和再次启动保留已选择的 %s 通道",
    async (channel) => {
      mocks.raw = { update: { channel, autoCheck: false } };
      const first = await import("./index");
      expect(first.store.get("update.channel")).toBe(channel);
      expect(first.store.get("update.autoCheck")).toBe(false);
      mocks.raw = JSON.parse(mocks.write.mock.calls.at(-1)![1]);
      mocks.version = "1.2.0";
      vi.resetModules();
      const second = await import("./index");
      expect(second.store.get("update.channel")).toBe(channel);
    },
  );

  it("旧配置缺少通道时补全 Beta，保留其他更新设置", async () => {
    mocks.raw = { update: { autoCheck: false } };
    const { store } = await import("./index");
    expect(store.get("update.channel")).toBe("beta");
    expect(store.get("update.autoCheck")).toBe(false);
  });

  it("导入保留显式通道，缺省导入与重置使用安装版本的默认值", async () => {
    const { store } = await import("./index");
    store.replaceAll({ update: { channel: "stable" } });
    expect(store.get("update.channel")).toBe("stable");
    store.replaceAll({ update: { autoCheck: false } });
    expect(store.get("update.channel")).toBe("beta");
    store.clear();
    expect(store.get("update.channel")).toBe("beta");
    store.flushImmediate();
  });

  it("修改新安装或空导入的通道不会改变重置默认值", async () => {
    const { store } = await import("./index");
    store.set("update.channel", "stable");
    store.flushImmediate();
    expect(JSON.parse(mocks.write.mock.calls.at(-1)![1]).update.channel).toBe("stable");
    store.clear();
    expect(store.get("update.channel")).toBe("beta");
    store.replaceAll({});
    store.set("update.channel", "nightly");
    store.replaceAll({});
    expect(store.get("update.channel")).toBe("beta");
    store.flushImmediate();
  });
});
