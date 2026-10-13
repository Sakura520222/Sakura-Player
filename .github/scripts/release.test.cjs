"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const { createDraftRelease } = require("./create-release.cjs");
const { getReleaseMetadata } = require("./release-metadata.cjs");
const { prepareReleaseAssets } = require("./prepare-release-assets.cjs");
const { withFixture } = require("./release-fixtures.cjs");

const repo = "Sakura520222/Sakura-Player";
const commit = "a".repeat(40);
const tag = "v1.2.0-beta.1";
const notesDir = path.join(__dirname, "../release-notes");

const runFixture = (callback, version = "1.2.0-beta.1", channel = "beta") => {
  withFixture(
    ({ src, out }) => {
      prepareReleaseAssets(src, out, version);
      const options = { version, tag: `v${version}`, repo, commit, assetsDir: out, notesDir };
      const calls = [];
      const run = (command, args) => {
        calls.push([command, args]);
        if (command === "git") return `${commit}\trefs/tags/${options.tag}\n`;
        if (args[0] === "api") return "[]";
        return "";
      };
      callback({ options, calls, run });
    },
    version,
    channel,
  );
};

for (const [version, channel] of [
  ["1.2.0", "latest"],
  ["1.2.0-beta.1", "beta"],
  ["1.2.0-alpha.1", "alpha"],
]) {
  test(`校验 ${channel} 的标签与版本`, () => {
    assert.deepEqual(getReleaseMetadata(version, `v${version}`), { version, channel });
  });
}

for (const [version, invalidTag] of [
  ["1.2.0-beta.1", "v1.2.0-beta.2"],
  ["1.2.0-beta.1", "dev"],
  ["1.2.0-nightly.100", "v1.2.0-nightly.100"],
  ["1.2.0-rc.1", "v1.2.0-rc.1"],
  ["1.2.0-beta.01", "v1.2.0-beta.01"],
  ["1.2.0\nunsafe", "v1.2.0\nunsafe"],
]) {
  test(`拒绝非法发布元数据 ${JSON.stringify(invalidTag)}`, () => {
    assert.throws(() => getReleaseMetadata(version, invalidTag));
  });
}

test("首次 Beta 使用人工说明和 --draft --prerelease，附带完整资源", () => {
  runFixture(({ options, calls, run }) => {
    createDraftRelease(options, run);
    const [command, args] = calls.at(-1);
    assert.equal(command, "gh");
    assert.deepEqual(args.slice(0, 3), ["release", "create", tag]);
    for (const flag of [
      "--draft",
      "--prerelease",
      "--verify-tag",
      "--latest=false",
      "--notes-file",
    ]) {
      assert.ok(args.includes(flag));
    }
    assert.ok(args.includes(path.join(notesDir, `${tag}.md`)));
    assert.equal(args.includes("--generate-notes"), false);
    assert.equal(args.filter((arg) => arg.startsWith(options.assetsDir)).length, 26);
  });
});

for (const [version, channel, prerelease] of [
  ["1.2.0", "latest", false],
  ["1.2.0-alpha.1", "alpha", true],
]) {
  test(`${channel} 保留发布通道且先创建草稿`, () => {
    runFixture(
      ({ options, calls, run }) => {
        createDraftRelease(options, run);
        const args = calls.at(-1)[1];
        assert.ok(args.includes("--draft"));
        assert.equal(args.includes("--prerelease"), prerelease);
      },
      version,
      channel,
    );
  });
}

for (const draft of [false, true]) {
  test(`重跑保留已有${draft ? "草稿" : "公开版本"}，不调用任何写操作`, () => {
    runFixture(({ options, calls, run }) => {
      const guarded = (command, args) => {
        if (args[0] === "api") {
          calls.push([command, args]);
          return JSON.stringify([{ tag_name: tag, draft }]);
        }
        return run(command, args);
      };
      assert.throws(() => createDraftRelease(options, guarded), draft ? /同名草稿/ : /已公开发布/);
      assert.equal(
        calls.some(([, args]) => args[0] === "release"),
        false,
      );
    });
  });
}

test("查询发行版遇到鉴权或网络失败时停止", () => {
  runFixture(({ options, calls, run }) => {
    const failing = (command, args) => {
      if (args[0] === "api") throw new Error("HTTP 403");
      return run(command, args);
    };
    assert.throws(() => createDraftRelease(options, failing), /HTTP 403/);
    assert.equal(
      calls.some(([, args]) => args[0] === "release"),
      false,
    );
  });
});

test("构建期间远程标签移动时停止", () => {
  runFixture(({ options, calls, run }) => {
    const moved = (command, args) => {
      if (command === "git") return `${"b".repeat(40)}\trefs/tags/${tag}\n`;
      return run(command, args);
    };
    assert.throws(() => createDraftRelease(options, moved), /远程标签/);
    assert.equal(calls.length, 0);
  });
});

test("注释标签校验剥离后的提交", () => {
  runFixture(({ options, calls, run }) => {
    const annotated = (command, args) => {
      if (command === "git")
        return `${"b".repeat(40)}\trefs/tags/${tag}\n${commit}\trefs/tags/${tag}^{}\n`;
      return run(command, args);
    };
    createDraftRelease(options, annotated);
    assert.equal(calls.at(-1)[1][0], "release");
  });
});

test("缺少首次发布说明时不能回退到历史提交自动说明", () => {
  runFixture(({ options, calls, run }) => {
    assert.throws(
      () =>
        createDraftRelease(
          { ...options, notesDir: path.join(options.assetsDir, "missing-notes") },
          run,
        ),
      /人工编写/,
    );
    assert.equal(calls.length, 0);
  });
});

test("上传失败后停止，不执行清理或发布", () => {
  runFixture(({ options, calls, run }) => {
    const failing = (command, args) => {
      const result = run(command, args);
      if (args[0] === "release") throw new Error("upload failed");
      return result;
    };
    assert.throws(() => createDraftRelease(options, failing), /upload failed/);
    assert.equal(calls.filter(([, args]) => args[0] === "release").length, 1);
  });
});

test("Release 工作流保留六架构和原有构建格式，并收敛写权限", () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(__dirname, "../workflows/release.yml"), "utf8"),
  );
  const { metadata, build, release } = workflow.jobs;
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(build.permissions, undefined);
  assert.deepEqual(release.permissions, { contents: "write" });
  assert.equal(build.needs, "metadata");
  assert.deepEqual(release.needs, ["metadata", "build"]);
  assert.deepEqual(
    build.strategy.matrix.include.map((item) => item.target),
    ["windows-x64", "windows-arm64", "macos-x64", "macos-arm64", "linux-x64", "linux-arm64"],
  );
  assert.equal(build.strategy["fail-fast"], false);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.ok(workflow.concurrency.group.includes("github.ref_name"));
  assert.equal(metadata.steps[0].with.ref, "refs/tags/${{ env.RELEASE_TAG }}");
  for (const job of [build, release]) {
    assert.equal(job.steps[0].with.ref, "${{ needs.metadata.outputs.commit }}");
    assert.equal(job.steps[0].with["persist-credentials"], false);
  }
  const buildStep = build.steps.find((step) => step.name === "Build ${{ matrix.name }}");
  assert.equal(buildStep.env.GH_TOKEN, undefined);
  for (const platform of ["win", "mac", "linux"]) {
    for (const arch of ["x64", "arm64"]) {
      assert.ok(buildStep.run.includes(`pnpm build:${platform} --${arch} --publish never`));
    }
  }
  assert.equal(build.steps.at(-1).with["if-no-files-found"], "error");
  assert.ok(release.steps.at(-2).run.includes("prepare-release-assets.cjs"));
  assert.ok(release.steps.at(-1).run.includes("create-release.cjs"));
});

test("Nightly 的写权限仅限滚动发布任务，固定标签不影响版本发行", () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(__dirname, "../workflows/nightly.yml"), "utf8"),
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs.release.permissions, { contents: "write" });
  assert.deepEqual(
    workflow.jobs.build.strategy.matrix.include.map((item) => item.target),
    ["windows-x64", "windows-arm64", "macos-x64", "macos-arm64", "linux-x64", "linux-arm64"],
  );
  const step = workflow.jobs.release.steps.at(-1);
  assert.equal(step.env.NIGHTLY_TAG, "nightly");
  assert.equal(
    workflow.jobs.build.steps.find((item) => item.name === "Build ${{ matrix.name }}").env
      .UPDATE_CHANNEL,
    "nightly",
  );
  assert.ok(step.run.includes('gh release delete "$NIGHTLY_TAG"'));
  assert.equal(step.run.includes("RELEASE_TAG"), false);
});
