"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const test = require("node:test");
const yaml = require("js-yaml");
const {
  SOURCE,
  verifyRecoverySource,
  readRecoverySource,
  verifyRecoveryArchive,
  recoverBetaRelease,
} = require("./recover-beta-release.cjs");

const makeSource = () => ({
  runInfo: {
    id: SOURCE.runId,
    repository: { id: SOURCE.repositoryId, full_name: SOURCE.repo },
    head_repository: { id: SOURCE.repositoryId, full_name: SOURCE.repo },
    workflow_id: SOURCE.workflowId,
    path: ".github/workflows/release.yml",
    event: "push",
    head_branch: SOURCE.tag,
    head_sha: SOURCE.commit,
    run_attempt: 1,
    status: "completed",
    conclusion: "failure",
  },
  jobs: [
    ...SOURCE.artifacts.map((artifact) => ({
      name: `Build on ${artifact.name.slice("Sakura-Player-".length)}`,
      run_id: SOURCE.runId,
      status: "completed",
      conclusion: "success",
      steps: [{ name: "Upload Artifact", conclusion: "success" }],
    })),
    { name: "Verify release metadata", run_id: SOURCE.runId, conclusion: "success" },
    {
      name: "Create GitHub Release",
      run_id: SOURCE.runId,
      conclusion: "failure",
      steps: [{ name: "Prepare release assets", conclusion: "failure" }],
    },
  ],
  artifacts: SOURCE.artifacts.map((artifact) => ({
    ...artifact,
    expired: false,
    workflow_run: {
      id: SOURCE.runId,
      repository_id: SOURCE.repositoryId,
      head_repository_id: SOURCE.repositoryId,
      head_branch: SOURCE.tag,
      head_sha: SOURCE.commit,
    },
  })),
  packageInfo: { name: "sakura-player", version: SOURCE.version },
  tagCommit: SOURCE.commit,
  releases: [],
});

test("固定首次 Beta 来源并接受完整原始运行", () => {
  assert.equal(SOURCE.repo, "Sakura520222/Sakura-Player");
  assert.equal(SOURCE.runId, 38402102612);
  assert.equal(SOURCE.commit, "65999d149eabc345e14df103fb9a389cb3a1b0da");
  assert.equal(SOURCE.tag, "v1.2.0-beta.1");
  assert.equal(SOURCE.version, "1.2.0-beta.1");
  assert.equal(SOURCE.artifacts.length, 6);
  verifyRecoverySource(makeSource());
});

for (const [key, value] of [
  ["id", 1],
  ["repository", { id: 1, full_name: SOURCE.repo }],
  ["repository", { id: SOURCE.repositoryId, full_name: "other/Sakura-Player" }],
  ["head_repository", { id: 1, full_name: "other/Sakura-Player" }],
  ["workflow_id", 1],
  ["path", ".github/workflows/dev.yml"],
  ["event", "workflow_dispatch"],
  ["head_branch", "dev"],
  ["head_sha", "a".repeat(40)],
  ["run_attempt", 2],
  ["status", "in_progress"],
  ["conclusion", "success"],
]) {
  test(`拒绝来源 Run 字段不符: ${key}=${JSON.stringify(value)}`, () => {
    const source = makeSource();
    source.runInfo[key] = value;
    assert.throws(() => verifyRecoverySource(source), /来源 Run/);
  });
}

test("拒绝已移动或缺失的远程 Tag", () => {
  for (const tagCommit of [undefined, "a".repeat(40)]) {
    const source = makeSource();
    source.tagCommit = tagCommit;
    assert.throws(() => verifyRecoverySource(source), /远程 Tag/);
  }
});

test("版本从原始提交读取，拒绝不同应用或版本", () => {
  for (const packageInfo of [
    { name: "splayer", version: SOURCE.version },
    { name: "sakura-player", version: "1.2.0-beta.2" },
  ]) {
    const source = makeSource();
    source.packageInfo = packageInfo;
    assert.throws(() => verifyRecoverySource(source), /原始提交的 package.json/);
  }
});

for (const index of [0, 1, 2, 3, 4, 5]) {
  test(`拒绝第 ${index + 1} 个架构构建或上传失败`, () => {
    for (const upload of [false, true]) {
      const source = makeSource();
      if (upload) source.jobs[index].steps[0].conclusion = "failure";
      else source.jobs[index].conclusion = "failure";
      assert.throws(() => verifyRecoverySource(source), /原始构建或 Artifact 上传/);
    }
  });

  test(`拒绝缺失第 ${index + 1} 个架构 Artifact`, () => {
    const source = makeSource();
    source.artifacts.splice(index, 1);
    assert.throws(() => verifyRecoverySource(source), /完整且唯一的六架构/);
  });
}

test("拒绝重复 Artifact 或任务，不通过数量校验伪造完整集合", () => {
  const source = makeSource();
  source.artifacts[5] = source.artifacts[0];
  assert.throws(() => verifyRecoverySource(source), /完整且唯一/);
  source.artifacts = makeSource().artifacts;
  source.jobs[5] = source.jobs[0];
  assert.throws(() => verifyRecoverySource(source), /任务集合/);
});

test("拒绝元数据验证失败或不同的发布失败位置", () => {
  const source = makeSource();
  source.jobs[6].conclusion = "failure";
  assert.throws(() => verifyRecoverySource(source), /失败位置/);
  source.jobs[6].conclusion = "success";
  source.jobs[7].steps[0].name = "Create GitHub Release";
  assert.throws(() => verifyRecoverySource(source), /失败位置/);
});

for (const [key, value] of [
  ["id", 1],
  ["name", "Sakura-Player-Linux x64"],
  ["expired", true],
  ["size_in_bytes", 0],
  ["digest", "sha256:" + "0".repeat(64)],
]) {
  test(`拒绝 Artifact 元数据不符: ${key}`, () => {
    const source = makeSource();
    source.artifacts[0][key] = value;
    assert.throws(() => verifyRecoverySource(source), /Artifact 来源/);
  });
}

for (const [key, value] of [
  ["id", 1],
  ["repository_id", 1],
  ["head_repository_id", 1],
  ["head_branch", "dev"],
  ["head_sha", "a".repeat(40)],
]) {
  test(`拒绝 Artifact 的构建来源不符: ${key}`, () => {
    const source = makeSource();
    source.artifacts[0].workflow_run[key] = value;
    assert.throws(() => verifyRecoverySource(source), /Artifact 来源/);
  });
}

const makeReadCommand = (source, calls) => (command, args) => {
  calls.push([command, args]);
  if (command === "git") {
    assert.equal(args[0], "ls-remote");
    return `${"b".repeat(40)}\trefs/tags/${SOURCE.tag}\n${source.tagCommit}\trefs/tags/${SOURCE.tag}^{}\n`;
  }
  assert.equal(command, "gh");
  assert.equal(args[0], "api");
  const endpoint = args.find((arg) => arg.startsWith("repos/"));
  if (endpoint.includes("/releases?")) {
    assert.ok(args.includes("--paginate") && args.includes("--slurp") && !args.includes("--jq"));
    return JSON.stringify([[{ tag_name: "nightly", draft: false }], source.releases]);
  }
  if (endpoint.includes("/jobs?"))
    return JSON.stringify([{ jobs: source.jobs.slice(0, 4) }, { jobs: source.jobs.slice(4) }]);
  if (endpoint.includes("/artifacts?"))
    return JSON.stringify([
      { artifacts: source.artifacts.slice(0, 3) },
      { artifacts: source.artifacts.slice(3) },
    ]);
  if (endpoint.includes("/contents/package.json?")) {
    assert.ok(endpoint.endsWith(`ref=${SOURCE.commit}`));
    return JSON.stringify(source.packageInfo);
  }
  return JSON.stringify(source.runInfo);
};

test("来源查询支持分页和注释 Tag，全部命令仅执行读取", () => {
  const source = makeSource();
  const calls = [];
  assert.deepEqual(readRecoverySource(makeReadCommand(source, calls)), {
    ...source,
    releases: [{ tag_name: "nightly", draft: false }],
  });
  assert.equal(calls.length, 6);
  assert.ok(calls.every(([command, args]) => command === "git" || args[0] === "api"));
});

for (const draft of [false, true]) {
  test(`同名${draft ? "草稿" : "公开发行版"}在后续页面时，下载前立即停止`, () => {
    const source = makeSource();
    source.releases.push({ tag_name: SOURCE.tag, draft });
    const calls = [];
    assert.throws(
      () => recoverBetaRelease("unused", "unused", makeReadCommand(source, calls)),
      /同名 Release/,
    );
    assert.equal(calls.length, 1);
  });
}

test("鉴权或网络失败不会被当作 Release 不存在", () => {
  const calls = [];
  const failing = (command, args) => {
    calls.push([command, args]);
    throw new Error("HTTP 403");
  };
  assert.throws(() => recoverBetaRelease("unused", "unused", failing), /HTTP 403/);
  assert.equal(calls.length, 1);
});

test("来源 SHA 不符时在下载前停止", () => {
  const source = makeSource();
  source.runInfo.head_sha = "a".repeat(40);
  const calls = [];
  assert.throws(
    () => recoverBetaRelease("unused", "unused", makeReadCommand(source, calls)),
    /来源 Run/,
  );
  assert.equal(calls.length, 6);
});

test("下载的 Artifact 校验失败时不解压、不聚合、不创建 Release", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-recovery-test-"));
  try {
    const calls = [];
    const read = makeReadCommand(makeSource(), calls);
    const corrupted = (command, args, options) => {
      if (command === "gh" && args.at(-1).endsWith("/zip")) {
        calls.push([command, args]);
        fs.writeSync(options.stdio[1], Buffer.from("corrupted"));
        return;
      }
      return read(command, args);
    };
    const out = path.join(root, "out");
    assert.throws(
      () => recoverBetaRelease(path.join(root, "download"), out, corrupted),
      /ZIP 大小不匹配/,
    );
    assert.equal(calls.length, 7);
    assert.equal(fs.existsSync(out), false);
    assert.ok(!calls.some(([command, args]) => command === "unzip" || args[0] === "release"));
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("sakura-recovery-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("复用非空目录时停止并保留原文件", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-recovery-test-"));
  try {
    fs.writeFileSync(path.join(root, "original"), "keep");
    const calls = [];
    assert.throws(
      () => recoverBetaRelease(root, path.join(root, "out"), makeReadCommand(makeSource(), calls)),
      /恢复目录必须为空/,
    );
    assert.equal(fs.readFileSync(path.join(root, "original"), "utf8"), "keep");
    assert.equal(calls.length, 6);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("sakura-recovery-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Artifact ZIP 验证大小和完整 SHA-256，拒绝同大小篡改", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sakura-recovery-test-"));
  try {
    const file = path.join(root, "archive.zip");
    const content = Buffer.alloc(128 * 1024 + 3, 42);
    const artifact = {
      name: "archive",
      size_in_bytes: content.length,
      digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    };
    fs.writeFileSync(file, content);
    verifyRecoveryArchive(file, artifact);
    fs.appendFileSync(file, "tampered");
    assert.throws(() => verifyRecoveryArchive(file, artifact), /ZIP 大小不匹配/);
    content[content.length - 1] ^= 1;
    fs.writeFileSync(file, content);
    assert.throws(() => verifyRecoveryArchive(file, artifact), /ZIP SHA-256 不匹配/);
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("sakura-recovery-test-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("一次性工作流只使用 dev 修复脚本和原始提交产物，默认验证且不自动公开", () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(__dirname, "../workflows/recover-beta-release.yml"), "utf8"),
  );
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs), ["mode"]);
  assert.equal(inputs.mode.default, "validate");
  assert.deepEqual(inputs.mode.options, ["validate", "create-draft"]);
  assert.equal(workflow.env.APP_VERSION, SOURCE.version);
  assert.equal(workflow.env.RELEASE_TAG, SOURCE.tag);
  assert.equal(workflow.env.BUILD_COMMIT, SOURCE.commit);
  assert.equal(workflow.concurrency.group, `release-${SOURCE.tag}`);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const steps = workflow.jobs.recover.steps;
  assert.ok(steps[0].run.includes('test "$GITHUB_REF" = "refs/heads/dev"'));
  const checkout = steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ github.sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  const draft = steps.find((step) => step.run?.includes(".github/scripts/create-release.cjs"));
  assert.equal(draft.if, "inputs.mode == 'create-draft'");
  const commands = steps.map((step) => step.run ?? "").join("\n");
  assert.ok(commands.includes(".github/scripts/recover-beta-release.cjs"));
  assert.ok(!/gh release (edit|delete|upload)|git (tag|push)|pnpm build|--clobber/.test(commands));
});
