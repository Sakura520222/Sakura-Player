# 首次 Beta 发行恢复

此流程仅用于恢复 `v1.2.0-beta.1`，在修复 PR 合并到 `dev` 后手动执行。
默认模式只下载、校验和聚合，不创建 Release。创建模式也只创建 Draft Pre-release，
公开发布必须由维护者在审阅草稿后手动完成。

## 固定来源

- 仓库：`Sakura520222/Sakura-Player`
- 原始运行：[38402102612](https://github.com/Sakura520222/Sakura-Player/actions/runs/38402102612)
- 原始提交：`65999d149eabc345e14df103fb9a389cb3a1b0da`
- 已存在的 Tag：`v1.2.0-beta.1`
- 版本：`1.2.0-beta.1`

| 架构          | 原始 Artifact ID |
| ------------- | ---------------- |
| Windows x64   | 11815948360      |
| Windows arm64 | 11818450067      |
| macOS x64     | 11816877319      |
| macOS arm64   | 11815703468      |
| Linux x64     | 11815883827      |
| Linux arm64   | 11816800980      |

工作流没有 Run、Tag、SHA 或版本输入，不能通过调度参数替换来源。
六个原始 ZIP 的大小和 SHA-256 固定在 `scripts/recover-beta-release.cjs`，
下载后必须严格匹配再解压。2026-10-13 查询时，六个 Artifact 均未过期，
保留期限为 2027-01-11；若恢复时已过期或缺失，流程会停止。

## 审核后执行

在 GitHub Actions 中选择 **Recover first Beta Release**，点击 **Run workflow**，
分支选 `dev`，先保留默认 `mode=validate`。
当前仓库默认分支为 `dev`；工作流必须已随修复 PR 合并到该分支。

也可以通过 GitHub CLI 仅验证：

```bash
gh workflow run recover-beta-release.yml \
  --repo Sakura520222/Sakura-Player \
  --ref dev \
  -f mode=validate
```

检查该运行的日志、Summary 和 `beta-recovery-verification-<run_id>` Artifact。
其中的 `verification.json` 记录原始六个 Artifact 的元数据、聚合后的文件大小，
并分别记录原始二进制提交 `buildCommit` 和执行修复脚本的 `scriptsCommit`。
应确认 18 个发行物齐全，Windows/macOS 两架构更新清单已合并，
Linux 两份清单保留各自架构，Beta 清单已生成 Alpha 通道别名。

审核通过后，重新调度并明确选择 `mode=create-draft`：

```bash
gh workflow run recover-beta-release.yml \
  --repo Sakura520222/Sakura-Player \
  --ref dev \
  -f mode=create-draft
```

此模式重新下载和执行全部校验，然后使用首次 Beta 人工编写的 Release Notes
及 `--verify-tag --draft --prerelease --latest=false` 创建草稿。
成功后，在仓库 Releases 页面检查 `v1.2.0-beta.1` 的 Draft 标记、预发布标记和资源。
流程没有公开草稿的步骤。

## 校验与停止条件

下载前先分页查询全部 Release。任何同名草稿或公开 Release 都会使流程停止，
鉴权或网络错误同样会停止，不能被当作“发行版不存在”。

来源校验包含仓库 ID、来源仓库、Release 工作流 ID/路径、Tag push 事件、
首次运行尝试、原始 SHA、远程 Tag 剥离后的提交，以及原始提交中的 `package.json`。
还要求原始六个构建和上传任务全部成功，失败位置确实是资源聚合，
并校验全部 Artifact 的唯一性、名称、ID、来源、大小、摘要和过期状态。

每个原始 ZIP 校验大小及 SHA-256 后解压，全部发行物使用修复后的
`prepare-release-assets.cjs` 聚合。原有完整性、非空文件、更新清单版本、平台引用、
资源大小与 SHA-512 检查全部保留；未被更新清单引用的包也受原始 ZIP 摘要保护。
创建前 `create-release.cjs` 再次检查资源、远程 Tag 和全部页面中的同名 Release。

同一 Tag 与常规 `release.yml` 共享并发锁。恢复工作流检出的是本次 `dev`
调度的提交，二进制只从原始 Run 下载，不执行重新构建。

不要重跑旧 Tag 的失败 Job，那会再次使用原始错误脚本。
不要强制移动、删除或重建 Tag，也不要删除现有 Release 或覆盖资源。
若上传中断留下不完整草稿，重跑会停止并保留现状，由维护者检查后处理；
流程不会自动清理草稿、覆盖资源或公开发布。

## Linux 真实命名

| 格式     | x64    | ARM64   |
| -------- | ------ | ------- |
| AppImage | x86_64 | arm64   |
| deb      | amd64  | arm64   |
| rpm      | x86_64 | aarch64 |
| tar.gz   | x64    | arm64   |
| pacman   | x64    | aarch64 |

文件仍以 `sakura-player-1.2.0-beta.1-` 为前缀。Windows 和 macOS 命名不变。

## 本地只读验证

已登录 GitHub CLI，且安装 Node.js、`js-yaml@4.1.1` 和 `unzip` 后，
可在包含修复脚本的检出目录执行：

```bash
pnpm test:release
node .github/scripts/recover-beta-release.cjs <全新临时目录> <全新输出目录>
```

该 Node 入口只查询、下载、校验和聚合，没有创建 Release 的能力。
输出目录必须为空，避免混入旧版本资源。
