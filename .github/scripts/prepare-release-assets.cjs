#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createHash } = require("node:crypto");
const yaml = require("js-yaml");
const { name: packageName } = require("../../package.json");
const { resolveChannel } = require("./release-metadata.cjs");

const MANIFEST_SUFFIXES = ["", "-mac", "-linux", "-linux-arm64"];
const SKIP_FILES = new Set(["builder-debug.yml", "builder-effective-config.yaml"]);
const PACKAGE_FORMATS = {
  "": { arches: ["x64", "arm64"], extensions: ["setup.exe", "portable.exe"] },
  "-mac": { arches: ["x64", "arm64"], extensions: ["dmg", "zip"] },
  "-linux": { arches: ["x64"], extensions: ["AppImage", "deb", "rpm", "tar.gz", "pacman"] },
  "-linux-arm64": { arches: ["arm64"], extensions: ["AppImage", "deb", "rpm", "tar.gz", "pacman"] },
};
// electron-builder 按包格式转换 Linux 架构名称，不能统一使用 Node.js 的架构名。
const LINUX_ARCH_NAMES = {
  x64: { AppImage: "x86_64", deb: "amd64", rpm: "x86_64", "tar.gz": "x64", pacman: "x64" },
  arm64: { AppImage: "arm64", deb: "arm64", rpm: "aarch64", "tar.gz": "arm64", pacman: "aarch64" },
};

/**
 * 递归收集目录下的文件
 * @param {string} dir - 起始目录
 * @param {string[]} [out] - 结果累加数组
 * @returns {string[]} 文件路径
 */
const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.endsWith("-unpacked")) walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
};

/**
 * 判断清单是否需要合并不同架构
 * @param {string} name - 文件名
 * @returns {boolean} 是否需要合并
 */
const shouldMergeManifest = (name) => /^(latest|beta|alpha|nightly)(-mac)?\.yml$/.test(name);

/**
 * 合并同平台不同架构的更新清单
 * @param {Array<Record<string, any>>} docs - 清单内容
 * @returns {Record<string, any>} 合并结果
 */
const mergeManifests = (docs) => {
  const versions = new Set(docs.map((doc) => doc.version));
  if (versions.size !== 1) throw new Error(`同名清单版本不一致: ${[...versions].join(", ")}`);

  const merged = { ...docs[0] };
  const byUrl = new Map();
  for (const doc of docs) {
    for (const file of doc.files || []) {
      const previous = byUrl.get(file.url);
      if (previous && (previous.sha512 !== file.sha512 || previous.size !== file.size)) {
        throw new Error(`同名清单资源内容不一致: ${file.url}`);
      }
      if (!byUrl.has(file.url)) byUrl.set(file.url, file);
    }
  }
  merged.files = [...byUrl.values()];
  const preferred = merged.files.find((file) => /x64|x86_64/i.test(file.url)) ?? merged.files[0];
  if (preferred) {
    merged.path = preferred.url;
    merged.sha512 = preferred.sha512;
  }
  return merged;
};

const ALIAS_CHANNELS_MAP = {
  latest: ["beta", "alpha"],
  beta: ["alpha"],
};

const VALIDATE_CHANNELS_MAP = {
  latest: ["latest", "beta", "alpha"],
  beta: ["beta", "alpha"],
  alpha: ["alpha"],
  nightly: ["nightly"],
};

/**
 * 为更不稳定的订阅通道创建清单别名
 * @param {string} outDir - 发布资源目录
 * @param {"latest" | "beta" | "alpha" | "nightly"} channel - 发布通道
 */
const createChannelAliases = (outDir, channel) => {
  const aliases = ALIAS_CHANNELS_MAP[channel] ?? [];
  for (const suffix of MANIFEST_SUFFIXES) {
    const source = path.join(outDir, `${channel}${suffix}.yml`);
    if (!fs.existsSync(source)) throw new Error(`缺少更新清单: ${path.basename(source)}`);
    for (const alias of aliases) {
      fs.copyFileSync(source, path.join(outDir, `${alias}${suffix}.yml`));
    }
  }
};

/**
 * 校验清单结构和引用资源
 * @param {string} outDir - 发布资源目录
 * @param {string} version - 应用版本
 * @param {"latest" | "beta" | "alpha" | "nightly"} channel - 发布通道
 */
const validateManifests = (outDir, version, channel) => {
  const channels = VALIDATE_CHANNELS_MAP[channel] ?? [channel];
  const packages = new Map();
  const expected = new Set();
  for (const [suffix, { arches, extensions }] of Object.entries(PACKAGE_FORMATS)) {
    const names = arches.flatMap((arch) =>
      extensions.map((extension) => {
        const packageArch = suffix.startsWith("-linux") ? LINUX_ARCH_NAMES[arch][extension] : arch;
        return suffix === ""
          ? `${packageName}-${version}-${arch}-${extension}`
          : `${packageName}-${version}-${packageArch}.${extension}`;
      }),
    );
    packages.set(suffix, names);
    for (const name of names) {
      expected.add(name);
      const asset = path.join(outDir, name);
      if (!fs.existsSync(asset)) throw new Error(`缺少发行物: ${name}`);
      if (!fs.statSync(asset).isFile() || fs.statSync(asset).size === 0) {
        throw new Error(`发行物为空或不是文件: ${name}`);
      }
    }
  }
  const manifests = new Set(
    channels.flatMap((current) => MANIFEST_SUFFIXES.map((suffix) => `${current}${suffix}.yml`)),
  );
  for (const name of fs.readdirSync(outDir)) {
    if (expected.has(name) || manifests.has(name)) continue;
    if (name.endsWith(".blockmap") && expected.has(name.slice(0, -9))) {
      if (fs.statSync(path.join(outDir, name)).size > 0) continue;
    }
    throw new Error(`发现不属于本次发布的资源: ${name}`);
  }
  // 清单别名复用摘要，按固定大小读取安装包，避免把大型文件全部装入内存。
  const hashes = new Map();
  const buffer = Buffer.alloc(64 * 1024);
  for (const current of channels) {
    for (const suffix of MANIFEST_SUFFIXES) {
      const name = `${current}${suffix}.yml`;
      const filePath = path.join(outDir, name);
      if (!fs.existsSync(filePath)) throw new Error(`缺少更新清单: ${name}`);

      const doc = yaml.load(fs.readFileSync(filePath, "utf8"));
      if (doc.version !== version) throw new Error(`${name} 的版本不是 ${version}`);
      if (!Array.isArray(doc.files) || doc.files.length === 0) {
        throw new Error(`${name} 没有可更新文件`);
      }
      const selected = doc.files.find((item) => item.url === doc.path);
      if (!selected || selected.sha512 !== doc.sha512) {
        throw new Error(`${name} 的默认更新文件无效`);
      }
      const names = packages.get(suffix);
      const updateExtension =
        suffix === "" ? "-setup.exe" : suffix === "-mac" ? ".zip" : ".AppImage";
      for (const name of names.filter((name) => name.endsWith(updateExtension))) {
        if (!doc.files.some((item) => item.url === name)) {
          throw new Error(`${name} 未包含在 ${current}${suffix}.yml 中`);
        }
      }
      for (const item of doc.files) {
        if (!names.includes(item.url))
          throw new Error(`${name} 引用了错误平台或版本的资源: ${item.url}`);
        const asset = path.join(outDir, item.url);
        if (!fs.existsSync(asset)) throw new Error(`${name} 引用了不存在的资源: ${item.url}`);
        if (item.size != null && fs.statSync(asset).size !== item.size) {
          throw new Error(`${name} 的资源大小不匹配: ${item.url}`);
        }
        if (!hashes.has(item.url)) {
          const hash = createHash("sha512");
          const fd = fs.openSync(asset, "r");
          try {
            let size;
            while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
              hash.update(buffer.subarray(0, size));
            }
          } finally {
            fs.closeSync(fd);
          }
          hashes.set(item.url, hash.digest("base64"));
        }
        if (hashes.get(item.url) !== item.sha512) {
          throw new Error(`${name} 的 SHA-512 不匹配: ${item.url}`);
        }
      }
    }
  }
};

/**
 * 整理并校验 GitHub Release 资源
 * @param {string} srcDir - 构建产物目录
 * @param {string} outDir - 发布资源目录
 * @param {string} version - 应用版本
 * @param {string} [releaseNotes] - 与发布页共用的更新说明
 */
const prepareReleaseAssets = (srcDir, outDir, version, releaseNotes) => {
  const channel = resolveChannel(version);
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    throw new Error(`发布资源目录必须为空: ${outDir}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  const manifestDocs = new Map();
  const seen = new Set();
  for (const file of walk(srcDir)) {
    const name = path.basename(file);
    if (SKIP_FILES.has(name)) continue;
    if (shouldMergeManifest(name)) {
      const doc = yaml.load(fs.readFileSync(file, "utf8"));
      if (!manifestDocs.has(name)) manifestDocs.set(name, []);
      manifestDocs.get(name).push(doc);
      continue;
    }
    if (seen.has(name)) throw new Error(`发现重复发布资源: ${name}`);
    seen.add(name);
    fs.copyFileSync(file, path.join(outDir, name));
  }

  for (const [name, docs] of manifestDocs) {
    const merged = mergeManifests(docs);
    fs.writeFileSync(path.join(outDir, name), yaml.dump(merged, { lineWidth: -1 }));
    console.log(`合并清单 ${name}（files: ${merged.files.length}）`);
  }

  if (releaseNotes !== undefined) {
    for (const suffix of MANIFEST_SUFFIXES) {
      const manifest = path.join(outDir, `${channel}${suffix}.yml`);
      const doc = yaml.load(fs.readFileSync(manifest, "utf8"));
      doc.releaseNotes = releaseNotes;
      fs.writeFileSync(manifest, yaml.dump(doc, { lineWidth: -1 }));
    }
  }

  createChannelAliases(outDir, channel);
  validateManifests(outDir, version, channel);
  console.log(`release-assets 校验完成，共 ${fs.readdirSync(outDir).length} 个文件`);
};

if (require.main === module) {
  const [srcDir, outDir, version, notesFile] = process.argv.slice(2);
  if (!srcDir || !outDir || !version) {
    console.error(
      "用法: node prepare-release-assets.cjs <artifactsDir> <outDir> <version> [releaseNotesFile]",
    );
    process.exit(1);
  }
  prepareReleaseAssets(
    srcDir,
    outDir,
    version,
    notesFile ? fs.readFileSync(notesFile, "utf8") : undefined,
  );
}

module.exports = { mergeManifests, prepareReleaseAssets, resolveChannel, validateManifests };
