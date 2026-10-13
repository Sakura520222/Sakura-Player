"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { getReleaseMetadata } = require("./release-metadata.cjs");
const { prepareReleaseAssets } = require("./prepare-release-assets.cjs");

// 固定原始运行和不可变 Artifact，恢复入口不接受替换来源的参数。
const SOURCE = {
  repo: "Sakura520222/Sakura-Player",
  repositoryId: 1416453058,
  runId: 38402102612,
  workflowId: 383128244,
  commit: "65999d149eabc345e14df103fb9a389cb3a1b0da",
  tag: "v1.2.0-beta.1",
  version: "1.2.0-beta.1",
  artifacts: [
    {
      id: 11815948360,
      name: "Sakura-Player-Windows x64",
      size_in_bytes: 202980815,
      digest: "sha256:6318d72324cbc426340e8781c9e6597bcf1a771df632305e1229b4e96e5c0d3c",
    },
    {
      id: 11818450067,
      name: "Sakura-Player-Windows arm64",
      size_in_bytes: 186530934,
      digest: "sha256:2375617aa3e48d2e4e33d09764390873129d4c125b55bcebabc2f12868405ae5",
    },
    {
      id: 11816877319,
      name: "Sakura-Player-macOS x64",
      size_in_bytes: 232542059,
      digest: "sha256:de4795f7c0116024991ff367316b064a0951e06abf0f080376b1c586d5651c5d",
    },
    {
      id: 11815703468,
      name: "Sakura-Player-macOS arm64",
      size_in_bytes: 228908935,
      digest: "sha256:04100fd1550fa747957f6a7a3a9097c74eb88ede26b509e6b3a6603d7e1e5f71",
    },
    {
      id: 11815883827,
      name: "Sakura-Player-Linux x64",
      size_in_bytes: 508195584,
      digest: "sha256:620d44b712fe1a63c14dbcaa3e25c279f391a1d9b5d849c22683d4628a65b3d1",
    },
    {
      id: 11816800980,
      name: "Sakura-Player-Linux arm64",
      size_in_bytes: 480310054,
      digest: "sha256:9fa06206887db9dd9124dd9cca0a39b8870682f7ae33c37cee383ac5b06685f4",
    },
  ],
};

/**
 * 校验首次 Beta 的原始运行、构建结果、标签、版本与产物来源
 * @param {{ runInfo: object, jobs: object[], artifacts: object[], packageInfo: object, tagCommit: string, releases: object[] }} source - GitHub 返回的原始元数据
 */
const verifyRecoverySource = (source) => {
  const { runInfo, jobs, artifacts, packageInfo, tagCommit, releases } = source;
  const existing = releases.find((release) => release.tag_name === SOURCE.tag);
  if (existing) throw new Error(`同名 Release ${SOURCE.tag} 已存在，保留发行版和全部资源`);
  if (
    runInfo.id !== SOURCE.runId ||
    runInfo.repository?.id !== SOURCE.repositoryId ||
    runInfo.repository?.full_name !== SOURCE.repo ||
    runInfo.head_repository?.id !== SOURCE.repositoryId ||
    runInfo.head_repository?.full_name !== SOURCE.repo ||
    runInfo.workflow_id !== SOURCE.workflowId ||
    runInfo.path !== ".github/workflows/release.yml" ||
    runInfo.event !== "push" ||
    runInfo.head_branch !== SOURCE.tag ||
    runInfo.head_sha !== SOURCE.commit ||
    runInfo.run_attempt !== 1 ||
    runInfo.status !== "completed" ||
    runInfo.conclusion !== "failure"
  ) {
    throw new Error("来源 Run 与首次 Beta 的原始发布运行不一致");
  }
  if (tagCommit !== SOURCE.commit) throw new Error("远程 Tag 未指向原始发布提交");
  if (packageInfo.name !== "sakura-player" || packageInfo.version !== SOURCE.version) {
    throw new Error("原始提交的 package.json 与首次 Beta 版本不一致");
  }
  getReleaseMetadata(packageInfo.version, SOURCE.tag);

  if (jobs.length !== 8 || new Set(jobs.map((job) => job.name)).size !== 8) {
    throw new Error("来源 Run 的任务集合不完整或重复");
  }
  for (const artifact of SOURCE.artifacts) {
    const name = `Build on ${artifact.name.slice("Sakura-Player-".length)}`;
    const job = jobs.find((job) => job.name === name);
    if (
      job?.run_id !== SOURCE.runId ||
      job?.status !== "completed" ||
      job?.conclusion !== "success" ||
      !job.steps?.some((step) => step.name === "Upload Artifact" && step.conclusion === "success")
    ) {
      throw new Error(`原始构建或 Artifact 上传未成功: ${name}`);
    }
  }
  const metadata = jobs.find((job) => job.name === "Verify release metadata");
  const release = jobs.find((job) => job.name === "Create GitHub Release");
  if (
    metadata?.run_id !== SOURCE.runId ||
    metadata?.conclusion !== "success" ||
    release?.run_id !== SOURCE.runId ||
    release?.conclusion !== "failure" ||
    !release.steps?.some(
      (step) => step.name === "Prepare release assets" && step.conclusion === "failure",
    )
  ) {
    throw new Error("来源 Run 的发布元数据或资源聚合失败位置不一致");
  }

  if (artifacts.length !== 6 || new Set(artifacts.map((artifact) => artifact.id)).size !== 6) {
    throw new Error("必须存在完整且唯一的六架构 Artifacts");
  }
  for (const expected of SOURCE.artifacts) {
    const artifact = artifacts.find((item) => item.id === expected.id);
    const origin = artifact?.workflow_run;
    if (
      artifact?.name !== expected.name ||
      artifact?.expired !== false ||
      artifact?.size_in_bytes !== expected.size_in_bytes ||
      artifact?.digest !== expected.digest ||
      origin?.id !== SOURCE.runId ||
      origin?.repository_id !== SOURCE.repositoryId ||
      origin?.head_repository_id !== SOURCE.repositoryId ||
      origin?.head_branch !== SOURCE.tag ||
      origin?.head_sha !== SOURCE.commit
    ) {
      throw new Error(`Artifact 来源或摘要不一致、缺失或已过期: ${expected.name}`);
    }
  }
};

/**
 * 读取原始发布来源，查询失败时直接停止，下载前先拒绝已有发行版
 * @param {typeof execFileSync} run - 命令执行入口
 * @returns {object} 已校验的发布来源
 */
const readRecoverySource = (run = execFileSync) => {
  const api = (endpoint, paginate = false) =>
    JSON.parse(
      run("gh", ["api", ...(paginate ? ["--paginate", "--slurp"] : []), endpoint], {
        encoding: "utf8",
      }),
    );
  const releases = api(`repos/${SOURCE.repo}/releases?per_page=100`, true).flat();
  if (releases.some((release) => release.tag_name === SOURCE.tag)) {
    throw new Error(`同名 Release ${SOURCE.tag} 已存在，保留发行版和全部资源`);
  }
  const runInfo = api(`repos/${SOURCE.repo}/actions/runs/${SOURCE.runId}`);
  const jobs = api(
    `repos/${SOURCE.repo}/actions/runs/${SOURCE.runId}/attempts/1/jobs?per_page=100`,
    true,
  ).flatMap((page) => page.jobs);
  const artifacts = api(
    `repos/${SOURCE.repo}/actions/runs/${SOURCE.runId}/artifacts?per_page=100`,
    true,
  ).flatMap((page) => page.artifacts);
  const packageInfo = JSON.parse(
    run(
      "gh",
      [
        "api",
        `repos/${SOURCE.repo}/contents/package.json?ref=${SOURCE.commit}`,
        "--header",
        "Accept: application/vnd.github.raw+json",
      ],
      { encoding: "utf8" },
    ),
  );
  const refs = run(
    "git",
    ["ls-remote", "--tags", "origin", `refs/tags/${SOURCE.tag}`, `refs/tags/${SOURCE.tag}^{}`],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/));
  const tagCommit = (refs.find(([, ref]) => ref === `refs/tags/${SOURCE.tag}^{}`) ??
    refs.find(([, ref]) => ref === `refs/tags/${SOURCE.tag}`))?.[0];
  const source = { runInfo, jobs, artifacts, packageInfo, tagCommit, releases };
  verifyRecoverySource(source);
  return source;
};

/**
 * 在解压前按固定大小读取 ZIP，校验原始 Artifact 的大小和 SHA-256
 * @param {string} file - 下载的 ZIP 文件
 * @param {{ name: string, size_in_bytes: number, digest: string }} artifact - 原始 Artifact 元数据
 */
const verifyRecoveryArchive = (file, artifact) => {
  if (!fs.statSync(file).isFile() || fs.statSync(file).size !== artifact.size_in_bytes) {
    throw new Error(`Artifact ZIP 大小不匹配: ${artifact.name}`);
  }
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, size));
    }
  } finally {
    fs.closeSync(fd);
  }
  if (`sha256:${hash.digest("hex")}` !== artifact.digest) {
    throw new Error(`Artifact ZIP SHA-256 不匹配: ${artifact.name}`);
  }
};

/**
 * 下载并校验原始六架构产物，使用当前修复脚本聚合；此入口没有 Release 写操作
 * @param {string} workDir - 全新的下载和验证目录
 * @param {string} outDir - 全新的发布资源目录
 * @param {typeof execFileSync} run - 命令执行入口
 * @returns {object} 恢复验证报告
 */
const recoverBetaRelease = (workDir, outDir, run = execFileSync) => {
  const source = readRecoverySource(run);
  for (const dir of [workDir, outDir]) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      throw new Error(`恢复目录必须为空: ${dir}`);
    }
  }
  const archivesDir = path.join(workDir, "archives");
  const artifactsDir = path.join(workDir, "artifacts");
  fs.mkdirSync(archivesDir, { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  for (const artifact of SOURCE.artifacts) {
    const archive = path.join(archivesDir, `${artifact.id}.zip`);
    const fd = fs.openSync(archive, "wx");
    try {
      console.log(`下载原始 Artifact: ${artifact.name} (${artifact.id})`);
      run("gh", ["api", `repos/${SOURCE.repo}/actions/artifacts/${artifact.id}/zip`], {
        stdio: ["ignore", fd, "inherit"],
      });
    } finally {
      fs.closeSync(fd);
    }
    verifyRecoveryArchive(archive, artifact);
    run("unzip", ["-q", archive, "-d", path.join(artifactsDir, artifact.name)], {
      stdio: "inherit",
    });
  }
  prepareReleaseAssets(artifactsDir, outDir, SOURCE.version);
  const report = {
    repository: SOURCE.repo,
    runId: SOURCE.runId,
    tag: SOURCE.tag,
    version: SOURCE.version,
    buildCommit: SOURCE.commit,
    scriptsCommit: run("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    artifacts: source.artifacts,
    assets: fs
      .readdirSync(outDir)
      .sort()
      .map((name) => ({ name, size: fs.statSync(path.join(outDir, name)).size })),
  };
  fs.writeFileSync(path.join(workDir, "verification.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`原始产物校验及聚合完成: ${SOURCE.tag}，未创建 Release`);
  return report;
};

if (require.main === module) {
  const [workDir, outDir] = process.argv.slice(2);
  if (!workDir || !outDir)
    throw new Error("用法: node recover-beta-release.cjs <workDir> <outDir>");
  recoverBetaRelease(workDir, outDir);
}

module.exports = {
  SOURCE,
  verifyRecoverySource,
  readRecoverySource,
  verifyRecoveryArchive,
  recoverBetaRelease,
};
