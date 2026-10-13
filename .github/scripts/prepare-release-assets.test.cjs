"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const {
  mergeManifests,
  prepareReleaseAssets,
  resolveChannel,
} = require("./prepare-release-assets.cjs");
const { createArtifact, createFixture, withFixture } = require("./release-fixtures.cjs");

test("正式版生成 latest、beta 和 alpha 的完整更新清单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-release-stable-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "out");
    createFixture(src, "1.2.0", "latest");
    prepareReleaseAssets(src, out, "1.2.0");
    for (const channel of ["latest", "beta", "alpha"]) {
      for (const suffix of ["", "-mac", "-linux", "-linux-arm64"]) {
        assert.equal(fs.existsSync(path.join(out, `${channel}${suffix}.yml`)), true);
      }
    }
    const windows = yaml.load(fs.readFileSync(path.join(out, "latest.yml"), "utf8"));
    assert.equal(windows.files.length, 2);
    assert.equal(windows.path, "sakura-player-1.2.0-x64-setup.exe");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Beta 版生成 beta 和 alpha 清单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-release-beta-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "out");
    createFixture(src, "1.3.0-beta.1", "beta");
    prepareReleaseAssets(src, out, "1.3.0-beta.1");
    assert.equal(fs.existsSync(path.join(out, "beta.yml")), true);
    assert.equal(fs.existsSync(path.join(out, "alpha.yml")), true);
    assert.equal(fs.existsSync(path.join(out, "latest.yml")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Alpha 版只发布 alpha 清单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-release-alpha-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "out");
    createFixture(src, "1.4.0-alpha.1", "alpha");
    prepareReleaseAssets(src, out, "1.4.0-alpha.1");
    assert.equal(fs.existsSync(path.join(out, "alpha.yml")), true);
    assert.equal(fs.existsSync(path.join(out, "beta.yml")), false);
    assert.equal(fs.existsSync(path.join(out, "latest.yml")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Nightly 版只发布 nightly 清单", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-release-nightly-"));
  try {
    const src = path.join(root, "artifacts");
    const out = path.join(root, "out");
    createFixture(src, "1.4.0-nightly.270", "nightly");
    prepareReleaseAssets(src, out, "1.4.0-nightly.270");
    assert.equal(fs.existsSync(path.join(out, "nightly.yml")), true);
    assert.equal(fs.existsSync(path.join(out, "alpha.yml")), false);
    assert.equal(fs.existsSync(path.join(out, "beta.yml")), false);
    assert.equal(fs.existsSync(path.join(out, "latest.yml")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("拒绝未支持的预发布通道", () => {
  assert.throws(() => resolveChannel("1.3.0-rc.1"), /不支持的预发布版本格式/);
});

for (const folder of ["win-x64", "win-arm64", "mac-x64", "mac-arm64", "linux-x64", "linux-arm64"]) {
  test(`拒绝缺少 ${folder} 全部产物的发布`, () => {
    withFixture(({ src, out, version }) => {
      const target = path.resolve(src, folder);
      assert.equal(path.dirname(target), path.resolve(src));
      fs.rmSync(target, { recursive: true });
      assert.throws(() => prepareReleaseAssets(src, out, version), /缺少(发行物|更新清单)/);
    });
  });
}

test("未被清单引用的便携包也必须存在", () => {
  withFixture(({ src, out, version }) => {
    fs.unlinkSync(path.join(src, "win-arm64", `sakura-player-${version}-arm64-portable.exe`));
    assert.throws(() => prepareReleaseAssets(src, out, version), /缺少发行物/);
  });
});

test("拒绝错误命名或版本的安装包", () => {
  withFixture(({ src, out, version }) => {
    createArtifact(path.join(src, "win-x64"), "splayer-1.1.0-x64-setup.exe");
    assert.throws(() => prepareReleaseAssets(src, out, version), /不属于本次发布/);
  });
});

test("拒绝包含 Nightly 清单的 Beta 发布", () => {
  withFixture(({ src, out, version }) => {
    fs.copyFileSync(
      path.join(src, "win-x64", "beta.yml"),
      path.join(src, "win-x64", "nightly.yml"),
    );
    assert.throws(() => prepareReleaseAssets(src, out, version), /不属于本次发布/);
  });
});

test("拒绝大小不匹配的更新包", () => {
  withFixture(({ src, out, version }) => {
    fs.appendFileSync(
      path.join(src, "win-x64", `sakura-player-${version}-x64-setup.exe`),
      "tampered",
    );
    assert.throws(() => prepareReleaseAssets(src, out, version), /资源大小不匹配/);
  });
});

test("拒绝大小相同但摘要不匹配的更新包", () => {
  withFixture(({ src, out, version }) => {
    const asset = path.join(src, "win-x64", `sakura-player-${version}-x64-setup.exe`);
    const data = fs.readFileSync(asset);
    data[0] ^= 1;
    fs.writeFileSync(asset, data);
    assert.throws(() => prepareReleaseAssets(src, out, version), /SHA-512 不匹配/);
  });
});

test("兼容打包器未提供 size 的更新条目，仍校验实际摘要", () => {
  withFixture(({ src, out, version }) => {
    const file = path.join(src, "mac-arm64", "beta-mac.yml");
    const doc = yaml.load(fs.readFileSync(file, "utf8"));
    delete doc.files[0].size;
    fs.writeFileSync(file, yaml.dump(doc));
    prepareReleaseAssets(src, out, version);
    const merged = yaml.load(fs.readFileSync(path.join(out, "beta-mac.yml"), "utf8"));
    assert.ok(merged.files.some((item) => item.url.includes("arm64") && item.size === undefined));
  });
});

test("合并后的 Windows 清单必须引用两个架构", () => {
  withFixture(({ src, out, version }) => {
    fs.unlinkSync(path.join(src, "win-arm64", "beta.yml"));
    assert.throws(() => prepareReleaseAssets(src, out, version), /未包含在 beta.yml/);
  });
});

test("拒绝清单的跨平台引用", () => {
  withFixture(({ src, out, version }) => {
    const file = path.join(src, "win-x64", "beta.yml");
    const doc = yaml.load(fs.readFileSync(file, "utf8"));
    doc.files.push({ ...doc.files[0], url: `sakura-player-${version}-x64.zip` });
    fs.writeFileSync(file, yaml.dump(doc));
    assert.throws(() => prepareReleaseAssets(src, out, version), /错误平台或版本/);
  });
});

test("拒绝更新清单版本不一致", () => {
  withFixture(({ src, out, version }) => {
    const file = path.join(src, "win-arm64", "beta.yml");
    const doc = yaml.load(fs.readFileSync(file, "utf8"));
    doc.version = "1.2.0-beta.2";
    fs.writeFileSync(file, yaml.dump(doc));
    assert.throws(() => prepareReleaseAssets(src, out, version), /同名清单版本不一致/);
  });
});

test("拒绝同名清单条目携带不同摘要", () => {
  assert.throws(
    () =>
      mergeManifests([
        { version: "1.2.0", files: [{ url: "app.exe", size: 10, sha512: "first" }] },
        { version: "1.2.0", files: [{ url: "app.exe", size: 10, sha512: "second" }] },
      ]),
    /同名清单资源内容不一致/,
  );
});

test("拒绝复用含旧产物的输出目录并保留原文件", () => {
  withFixture(({ src, out, version }) => {
    createArtifact(out, "previous.exe");
    assert.throws(() => prepareReleaseAssets(src, out, version), /发布资源目录必须为空/);
    assert.equal(fs.readFileSync(path.join(out, "previous.exe"), "utf8"), "previous.exe");
  });
});

test("接受独立构建生成的 blockmap，跳过打包器诊断文件", () => {
  withFixture(({ src, out, version }) => {
    const folder = path.join(src, "win-x64");
    createArtifact(folder, `sakura-player-${version}-x64-setup.exe.blockmap`);
    createArtifact(folder, "builder-debug.yml");
    createArtifact(folder, "builder-effective-config.yaml");
    prepareReleaseAssets(src, out, version);
    assert.equal(fs.readdirSync(out).filter((name) => !/\.(yml|blockmap)$/.test(name)).length, 18);
    assert.equal(fs.existsSync(path.join(out, "builder-debug.yml")), false);
  });
});
