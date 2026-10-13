"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { getReleaseMetadata } = require("./release-metadata.cjs");
const { validateManifests } = require("./prepare-release-assets.cjs");

/**
 * 只创建新的完整草稿；任何同名发行版都交由维护者处理，避免重跑修改公开资源
 * @param {{ version: string, tag: string, repo: string, commit: string, assetsDir: string, notesDir: string }} options - 本次发布参数
 * @param {typeof execFileSync} run - 命令执行入口
 */
const createDraftRelease = (options, run = execFileSync) => {
  const { version, tag, repo, commit, assetsDir, notesDir } = options;
  const { channel } = getReleaseMetadata(version, tag);
  validateManifests(assetsDir, version, channel);
  const notes = path.join(notesDir, `${tag}.md`);
  if (tag === "v1.2.0-beta.1" && !fs.existsSync(notes)) {
    throw new Error("首次 Beta 必须使用人工编写的 Release Notes");
  }

  const refs = run(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`],
    {
      encoding: "utf8",
    },
  )
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  const tagCommit = (refs.find(([, ref]) => ref === `refs/tags/${tag}^{}`) ??
    refs.find(([, ref]) => ref === `refs/tags/${tag}`))?.[0];
  if (tagCommit !== commit) throw new Error("远程标签不存在或在构建期间发生变化，拒绝创建草稿");

  // 查询失败直接退出，不能把鉴权或网络失败当成发行版不存在。
  const releases = JSON.parse(
    run(
      "gh",
      [
        "api",
        "--paginate",
        "--slurp",
        `repos/${repo}/releases?per_page=100`,
        "--jq",
        "[.[][] | {tag_name, draft}]",
      ],
      { encoding: "utf8" },
    ),
  );
  const existing = releases.find((release) => release.tag_name === tag);
  if (existing) {
    throw new Error(
      existing.draft
        ? `同名草稿 ${tag} 已存在，保留草稿和资源，请维护者检查后处理`
        : `${tag} 已公开发布，禁止重跑修改发行版或资源`,
    );
  }

  const args = [
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--title",
    tag,
    "--verify-tag",
    "--draft",
  ];
  if (channel !== "latest") args.push("--prerelease", "--latest=false");
  if (fs.existsSync(notes)) args.push("--notes-file", notes);
  else args.push("--generate-notes");
  args.push(
    ...fs
      .readdirSync(assetsDir)
      .sort()
      .map((name) => path.join(assetsDir, name)),
  );
  run("gh", args, { stdio: "inherit" });
};

if (require.main === module) {
  createDraftRelease({
    version: process.env.APP_VERSION,
    tag: process.env.RELEASE_TAG,
    repo: process.env.GITHUB_REPOSITORY,
    commit: process.env.BUILD_COMMIT,
    assetsDir: "release-assets",
    notesDir: path.join(__dirname, "../release-notes"),
  });
}

module.exports = { createDraftRelease };
