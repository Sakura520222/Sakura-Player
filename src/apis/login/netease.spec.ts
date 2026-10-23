import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ check: vi.fn(), call: vi.fn() }));
vi.mock("@/apis/netease", () => ({
  netease: { login_qr_check: api.check },
  neteaseCall: api.call,
  NeteaseApiError: class extends Error {},
}));

import { qrCheck, syncNeteaseDeviceName } from "./netease";

describe("网易云登录设备上报", () => {
  beforeEach(() => {
    api.check.mockReset();
    api.call.mockReset().mockResolvedValue({ code: 200 });
  });

  it.each([800, 801, 802])("扫码状态 %s 不触发设备上报", async (code) => {
    api.check.mockResolvedValue({ code });
    expect(await qrCheck("test-key")).toMatchObject({ code });
    expect(api.call).not.toHaveBeenCalled();
  });

  it("登录成功后异步上报，等待上报不阻塞扫码结果", async () => {
    api.check.mockResolvedValue({ code: 803, cookie: "MUSIC_U=test", nickname: "测试用户" });
    const upload = Promise.withResolvers<void>();
    api.call.mockReturnValue(upload.promise);
    try {
      expect(await qrCheck("test-key")).toMatchObject({ code: 803, nickname: "测试用户" });
      expect(api.call).toHaveBeenCalledWith(
        "deviceinfo_center_upload",
        {},
        { notifyAuthFailure: false },
      );
    } finally {
      upload.resolve();
    }
  });

  it("上报失败不影响扫码登录，也不抛出网页登录上报错误", async () => {
    api.check.mockResolvedValue({ code: 803 });
    api.call.mockRejectedValue(new Error("设备信息接口不可用"));
    await expect(qrCheck("test-key")).resolves.toMatchObject({ code: 803 });
    await expect(syncNeteaseDeviceName()).resolves.toBeUndefined();
  });
});
