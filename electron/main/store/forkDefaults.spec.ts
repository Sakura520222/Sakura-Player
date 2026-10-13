import { describe, expect, it } from "vitest";
import { defaultSystemConfig } from "@shared/defaults/settings";
import { deepMerge } from "./utils";

describe("Fork 外部服务默认配置", () => {
  it("新配置使用独立端口，并保留默认关闭和仅本机访问", () => {
    const config = deepMerge(defaultSystemConfig, {});
    expect(config.externalApi).toMatchObject({
      enabled: false,
      wsEnabled: false,
      allowLan: false,
      port: 14568,
    });
    expect(config.mcp).toMatchObject({ enabled: false, port: 14569 });
    expect(config.externalApi.port).not.toBe(config.mcp.port);
  });

  it("已保存的端口和启用状态不会被新默认值覆盖", () => {
    const config = deepMerge(defaultSystemConfig, {
      externalApi: { enabled: true, port: 14558 },
      mcp: { enabled: true, port: 14559, accessKey: "saved-key" },
    });
    expect(config.externalApi).toMatchObject({ enabled: true, port: 14558 });
    expect(config.mcp).toMatchObject({ enabled: true, port: 14559, accessKey: "saved-key" });
  });
});
