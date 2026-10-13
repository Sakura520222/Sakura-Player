"use strict";

const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

/**
 * 从完整版本号解析更新清单通道
 * @param {string} version - 应用版本
 * @returns {"latest" | "beta" | "alpha" | "nightly"} 更新清单通道
 */
const resolveChannel = (version) => {
  const number = "(?:0|[1-9]\\d*)";
  const match = new RegExp(
    `^${number}\\.${number}\\.${number}(?:-(alpha|beta|nightly)(?:\\.${number})*)?$`,
  ).exec(version);
  if (!match) throw new Error(`不支持的预发布版本格式或版本号: ${version}`);
  return match[1] ?? "latest";
};

/**
 * 校验独立版本发布，Nightly 由滚动发布流程处理
 * @param {string} version - 应用版本
 * @param {string} tag - 待发布标签
 * @returns {{ version: string, channel: string }} 发布元数据
 */
const getReleaseMetadata = (version, tag) => {
  const channel = resolveChannel(version);
  if (channel === "nightly") throw new Error("Nightly 必须使用独立的滚动发布流程");
  if (tag !== `v${version}`) {
    throw new Error(`标签 ${tag} 与 package.json 版本 v${version} 不一致`);
  }
  return { version, channel };
};

if (require.main === module) {
  const { version } = require("../../package.json");
  const tag = process.env.RELEASE_TAG;
  const metadata = getReleaseMetadata(version, tag);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const tagCommit = execFileSync("git", ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`], {
    encoding: "utf8",
  }).trim();
  if (tagCommit !== commit) throw new Error("检出的提交与发布标签不一致");
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${metadata.version}\nchannel=${metadata.channel}\ncommit=${commit}\n`,
  );
  console.log(`发布元数据已验证: ${tag}, ${metadata.channel}, ${commit}`);
}

module.exports = { resolveChannel, getReleaseMetadata };
