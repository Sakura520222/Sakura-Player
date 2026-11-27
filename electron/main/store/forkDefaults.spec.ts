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

describe("听歌伙伴回复气泡配置", () => {
  it("旧配置沿用已保存的角色设置，并补齐回复气泡默认值", () => {
    const config = deepMerge(defaultSystemConfig, {
      companion: { enabled: true, alwaysOnTop: false },
    });
    expect(config.companion).toMatchObject({
      enabled: true,
      alwaysOnTop: false,
      replyBubble: true,
      replyBubbleSeconds: 8,
    });
  });

  it("读取或导入配置时保留已关闭的气泡和自定义停留时间", () => {
    const config = deepMerge(defaultSystemConfig, {
      companion: { replyBubble: false, replyBubbleSeconds: 27 },
    });
    expect(config.companion).toMatchObject({ replyBubble: false, replyBubbleSeconds: 27 });
  });
});
