"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const yaml = require("js-yaml");

const LINUX_ARCH_NAMES = {
  x64: { AppImage: "x86_64", deb: "amd64", rpm: "x86_64", "tar.gz": "x64", pacman: "x64" },
  arm64: { AppImage: "arm64", deb: "arm64", rpm: "aarch64", "tar.gz": "arm64", pacman: "aarch64" },
};

const createArtifact = (dir, name, content = Buffer.from(name)) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
  return {
    url: name,
    sha512: createHash("sha512").update(content).digest("base64"),
    size: content.length,
  };
};

const writeManifest = (dir, name, version, asset) => {
  fs.writeFileSync(
    path.join(dir, name),
    yaml.dump({ version, files: [asset], path: asset.url, sha512: asset.sha512 }),
  );
};

const createFixture = (root, version, channel) => {
  const assets = [
    ["win-x64", `${channel}.yml`, "x64", ["setup.exe", "portable.exe"]],
    ["win-arm64", `${channel}.yml`, "arm64", ["setup.exe", "portable.exe"]],
    ["mac-x64", `${channel}-mac.yml`, "x64", ["zip", "dmg"]],
    ["mac-arm64", `${channel}-mac.yml`, "arm64", ["zip", "dmg"]],
    ["linux-x64", `${channel}-linux.yml`, "x64", ["AppImage", "deb", "rpm", "tar.gz", "pacman"]],
    [
      "linux-arm64",
      `${channel}-linux-arm64.yml`,
      "arm64",
      ["AppImage", "deb", "rpm", "tar.gz", "pacman"],
    ],
  ];
  for (const [folder, manifest, arch, extensions] of assets) {
    const dir = path.join(root, folder);
    const files = extensions.map((extension) => {
      const packageArch = folder.startsWith("linux") ? LINUX_ARCH_NAMES[arch][extension] : arch;
      const assetName = `sakura-player-${version}-${packageArch}${folder.startsWith("win") ? "-" : "."}${extension}`;
      return createArtifact(dir, assetName);
    });
    writeManifest(dir, manifest, version, files[0]);
  }
};

const withFixture = (callback, version = "1.2.0-beta.1", channel = "beta") => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-release-test-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "release-assets");
    createFixture(src, version, channel);
    callback({ root, src, out, version, channel });
  } finally {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("sakura-release-test-")
    ) {
      throw new Error("测试目录超出临时目录范围");
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
};

module.exports = { createArtifact, writeManifest, createFixture, withFixture };
