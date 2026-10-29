import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disk: "",
  rotate: false,
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("node:fs", () => ({
  default: {
    existsSync: () => true,
    readFileSync: () => mocks.disk,
    rmSync: () => {
      mocks.disk = "";
    },
  },
}));
vi.mock("atomically", () => ({
  writeFileSync: (_path: string, text: string) => {
    mocks.disk = text;
  },
}));
vi.mock("@main/utils/paths", () => ({ configDir: "test-config" }));
vi.mock("@main/utils/logger", () => ({ lastfmLog: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("electron", () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: mocks.encrypt,
    decryptStringAsync: mocks.decrypt,
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.disk = "";
  mocks.rotate = false;
  mocks.encrypt
    .mockReset()
    .mockImplementation(async (value: string) => Buffer.from(`cipher:${value}`));
  mocks.decrypt.mockReset().mockImplementation(async (buffer: Buffer) => ({
    result: buffer.toString().replace(/^cipher:/, ""),
    shouldReEncrypt: mocks.rotate,
  }));
});

describe("Last.fm 异步凭据", () => {
  it("读取旧凭据后按系统要求轮换密钥", async () => {
    const service = await import("./credentials");
    await service.save("listener", "session-secret");
    mocks.rotate = true;
    mocks.encrypt.mockResolvedValueOnce(Buffer.from("rotated"));
    expect(await service.load()).toEqual({ username: "listener", sessionKey: "session-secret" });
    expect(JSON.parse(mocks.disk).encryptedSessionKey).toBe(
      Buffer.from("rotated").toString("base64"),
    );
  });

  it.each(["轮换", "保存"])("%s期间断开连接不会恢复已清除的凭据", async (action) => {
    const service = await import("./credentials");
    await service.save("listener", "session-secret");
    mocks.rotate = true;
    const pending = Promise.withResolvers<Buffer>();
    mocks.encrypt.mockClear().mockReturnValueOnce(pending.promise);
    const request = action === "轮换" ? service.load() : service.save("new", "new-secret");
    await vi.waitFor(() => expect(mocks.encrypt).toHaveBeenCalledOnce());
    service.clear();
    pending.resolve(Buffer.from("cipher:session-secret"));
    await request;
    expect(mocks.disk).toBe("");
    expect(await service.load()).toBeNull();
  });

  it("轮换回写失败不影响已解密会话", async () => {
    const service = await import("./credentials");
    await service.save("listener", "session-secret");
    const saved = mocks.disk;
    mocks.rotate = true;
    mocks.encrypt.mockRejectedValueOnce(new Error("暂不可用"));
    expect(await service.load()).toEqual({ username: "listener", sessionKey: "session-secret" });
    expect(mocks.disk).toBe(saved);
  });
});
