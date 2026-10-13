import { describe, expect, it } from "vitest";
import { parseDownloadAsset, selectRecommendedAssets, sortDownloadAssets } from "./downloadAssets";

const parse = (name: string) => parseDownloadAsset(name, `https://example.com/${name}`, 1024);

describe("parseDownloadAsset", () => {
  it.each([
    ["sakura-player-1.2.0-beta.1-x64-setup.exe", "Windows", "x64", "installer"],
    ["sakura-player-1.2.0-beta.1-arm64-setup.exe", "Windows", "ARM64", "installer"],
    ["sakura-player-1.2.0-beta.1-x64-portable.exe", "Windows", "x64", "portable"],
    ["sakura-player-1.2.0-beta.1-arm64-portable.exe", "Windows", "ARM64", "portable"],
    ["sakura-player-1.2.0-beta.1-x64.dmg", "macOS", "x64", "dmg"],
    ["sakura-player-1.2.0-beta.1-arm64.zip", "macOS", "ARM64", "zip"],
    ["sakura-player-1.2.0-beta.1-arm64.AppImage", "Linux", "ARM64", "AppImage"],
    ["sakura-player-1.2.0-beta.1-x64.deb", "Linux", "x64", "deb"],
    ["sakura-player-1.2.0-beta.1-arm64.rpm", "Linux", "ARM64", "rpm"],
    ["sakura-player-1.2.0-beta.1-x64.pacman", "Linux", "x64", "pacman"],
    ["sakura-player-1.2.0-beta.1-x64.tar.gz", "Linux", "x64", "tar.gz"],
  ])("识别当前构建配置的产物 %s", (name, platform, arch, format) => {
    expect(parse(name)).toMatchObject({ platform, arch, format });
  });

  it.each([
    ["sakura-player-1.0.0-x64.AppImage", "x64", "AppImage"],
    ["sakura-player-1.0.0-amd64.deb", "x64", "deb"],
    ["sakura-player-1.0.0-aarch64.rpm", "ARM64", "rpm"],
    ["sakura-player-1.0.0-arm64.pacman", "ARM64", "pacman"],
    ["sakura-player-1.0.0-x86_64.tar.gz", "x64", "tar.gz"],
  ])("识别 Linux 资源 %s", (name, arch, format) => {
    expect(parse(name)).toMatchObject({ platform: "Linux", arch, format });
  });

  it.each(["latest-linux.yml", "app.exe.blockmap", "splayer-debug.zip", "checksums.txt"])(
    "忽略非安装资源 %s",
    (name) => {
      expect(parse(name)).toBeNull();
    },
  );
});

describe("selectRecommendedAssets", () => {
  it("Windows 始终优先推荐安装版", () => {
    const assets = [
      parse("sakura-player-1.0.0-portable-x64.exe"),
      parse("sakura-player-1.0.0-x64.exe"),
    ].filter((asset) => asset !== null);

    expect(selectRecommendedAssets(assets, "Windows", "x64").map((asset) => asset.format)).toEqual([
      "installer",
      "portable",
    ]);
  });

  it("Linux 只推荐匹配架构的通用 AppImage", () => {
    const assets = [
      parse("sakura-player-1.0.0-x64.deb"),
      parse("sakura-player-1.0.0-x64.pacman"),
      parse("sakura-player-1.0.0-x64.AppImage"),
      parse("sakura-player-1.0.0-arm64.AppImage"),
    ].filter((asset) => asset !== null);

    expect(selectRecommendedAssets(assets, "Linux", "x64").map((asset) => asset.format)).toEqual([
      "AppImage",
    ]);
  });

  it("没有 AppImage 时回退到已有的 Linux 安装包", () => {
    const assets = [parse("sakura-player-1.0.0-x64.pacman")].filter((asset) => asset !== null);

    expect(selectRecommendedAssets(assets, "Linux", "x64").map((asset) => asset.format)).toEqual([
      "pacman",
    ]);
  });
});

describe("sortDownloadAssets", () => {
  it("将默认安装方式排在便携版和压缩包之前", () => {
    const assets = [
      parse("sakura-player-1.0.0-portable-x64.exe"),
      parse("sakura-player-1.0.0-x64.zip"),
      parse("sakura-player-1.0.0-x64.exe"),
    ].filter((asset) => asset !== null);

    expect(sortDownloadAssets(assets).map((asset) => asset.format)).toEqual([
      "installer",
      "portable",
      "zip",
    ]);
  });
});
