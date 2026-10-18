<div align="center">

<img alt="Sakura Player logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>Sakura Player</h2>

<p>🎵 跨平台桌面音乐播放器，支持本地曲库、自建媒体源、逐字歌词与 AI 歌词辅助</p>

<p>基于 <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a> 的非官方二次开发版本，由 <a href="https://github.com/Sakura520222">Sakura520222</a> 维护</p>

[![Stars](https://img.shields.io/github/stars/Sakura520222/Sakura-Player?style=flat)](https://github.com/Sakura520222/Sakura-Player/stargazers)
[![Release](https://img.shields.io/github/v/release/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/releases)
[![License](https://img.shields.io/github/license/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/issues)

**简体中文** | [English](./README.en.md)

[下载](https://sakura-player.pyabunny.com/download.html) · [使用指南](https://sakura-player.pyabunny.com/guide.html) · [AI 功能](https://sakura-player.pyabunny.com/ai.html) · [问题反馈](https://github.com/Sakura520222/Sakura-Player/issues)

</div>

---

> [!NOTE]
> Sakura Player 是社区维护的非官方分支，与 SPlayer-Next 官方项目无隶属关系。
> 上游原版由 [imsyy](https://github.com/imsyy) 与 [SPlayer-Dev](https://github.com/SPlayer-Dev) 组织开发，仓库地址为 <https://github.com/SPlayer-Dev/SPlayer-Next>。
> Sakura Player 可与上游原版独立安装、并存使用，并独立管理自己的用户数据。
> Fork 修改日期：**2026-10-13**。上游版权声明与来源信息保留于 [NOTICE](./NOTICE)。

## 相对上游的新增功能

以下按 Sakura Player **v1.2.0-beta.4** 与上游 **2026-10-18 的 `dev`（[`aa460b50`](https://github.com/SPlayer-Dev/SPlayer-Next/commit/aa460b502639167c82d4fb7e06ce10f9f744d11b)）** 的代码差异整理，功能归属以上述基线为准

### 二开新增功能

| 功能                                                                            | 本分支新增内容                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [歌曲高潮查询与跳转](https://sakura-player.pyabunny.com/playback.html#歌曲高潮) | 查询网易云副歌与酷狗高潮标注，进度条显示金色区间，火焰按钮一键跳转；支持多段标注、普通 / 浮动 / 全屏布局，以及本地、QQ 音乐和流媒体歌曲的元数据匹配                                            |
| [AI 歌词翻译与生成](https://sakura-player.pyabunny.com/ai.html)                 | 自选翻译、音译、逐字翻译与逐字音译；支持简中、繁中、英、日、韩译文，提供补齐缺失与从头完整生成两种模式，并保留未选择的辅助轨道                                                                 |
| AI 模型调用与续译                                                               | 在上游已有模型配置的基础上，新增 OpenAI Compatible / Anthropic 实际文本调用、连接测试、流式预览与取消，以及 OpenAI 兼容服务的思考等级设置；失败或取消后可在当前弹窗会话内继续生成              |
| [本地歌词智能对齐](https://sakura-player.pyabunny.com/lyric-alignment.html)     | 无需模型 API Key，将已有翻译、音译映射到主歌词逐字时间轴；支持重新对齐、逐行预览和勾选应用。日语音译开箱即用，翻译对齐提供专用环境和模型的安装、后台下载、取消、重试与卸载，准备完成后离线运行 |
| [完整歌词保存](https://sakura-player.pyabunny.com/lyrics.html#复制、分享与保存) | 在复制工具中新增整首歌词保存，可写入本地独立音频标签、导出 LRC 或保存符合条件的 TTML；音乐标签保留原歌词格式与辅助轨道，支持跨词音译范围的保存与恢复                                           |
| 保存前差异预览                                                                  | 按音乐标签、LRC、TTML 目标查看写入前后的歌词差异，显示增删行、格式变化和已确定的目标路径                                                                                                       |
| 喜欢列表一键复制                                                                | 将「我喜欢的音乐」中当前筛选、排序后的整份列表复制为「歌名 - 歌手」，顺序与页面一致                                                                                                            |
| 暂停时隐藏灵动岛                                                                | 新增可选的暂停自动收起与恢复播放后重新显示，保留窗口位置                                                                                                                                       |

AI 生成和本地对齐处理已有歌词文本，沿用主歌词时间轴，不识别音频或重新打轴；应用结果后仍需显式保存。LRC 中的译文按行导出，完整逐字译文需保存到音乐标签或符合条件的 TTML。歌曲高潮依赖联网查询平台已有标注，插件来源歌曲暂不参与

### 二开体验与配套改进

- **歌词显示**：新增逐字译文高亮，完善辅助歌词折行高亮、跨词音译关联、音译居中排版，以及应用后的即时刷新，适配默认与 AMLL 引擎
- **音频输出**：增加输出边界的短时平滑淡变，改进输出流异步回收，修复切歌时旧输出流未及时停止的问题
- **独立发行与并存**：独立应用标识、安装名称、用户数据和更新源；便携版使用 `SakuraPlayerData/`，新配置使用独立服务端口，保留插件与 MCP 兼容接口，详见下方 [Fork 兼容与并存](#fork-兼容与并存)
- **更新与维护**：初始更新通道跟随安装版本，并保留用户已选通道；完善发行资源校验、原生构建失败重试、列表表头显示和中英文文档，贡献者列表将本仓库作者置顶

### 上游继承与同步功能

FFmpeg / Rust 解码、CUE 分轨、本地曲库与歌单、听歌统计、在线音乐、自建媒体源、听歌识曲、音乐下载、基础歌词格式与逐字显示、桌面歌词 / 灵动岛 / Windows 任务栏歌词、系统媒体控制、插件、HTTP / WebSocket API 和 MCP 等能力继承自 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next)，感谢 imsyy 与上游贡献者

流媒体子系统重构、插件与 MCP 扩展、播放页屏幕常亮、酷狗列表分页修复，以及当前上游已有的翻译 / 音译副行独立字号等，归入上游已有或同步改进

## 功能特性

以下为完整功能概览，包含上游继承能力与本分支新增功能，功能归属见上方说明

| 功能           | 内容                                                                                                       | 使用说明                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 音频播放       | FFmpeg + Rust 引擎，支持 MP3、FLAC、WAV、AAC、OGG、APE 等格式与 CUE 分轨                                   | [播放控制](https://sakura-player.pyabunny.com/playback.html)                                                                                                       |
| 曲库与歌单     | 目录扫描、歌曲 / 歌手 / 专辑 / 文件夹浏览、本地歌单、喜欢、历史与听歌统计                                  | [曲库管理](https://sakura-player.pyabunny.com/library.html)                                                                                                        |
| 标签与封面     | 编辑本地独立音频的曲名、歌手、专辑与封面，支持批量管理                                                     | [元信息编辑](https://sakura-player.pyabunny.com/library.html#标签与封面)                                                                                           |
| 在线音乐       | 网易云喜欢、收藏、每日推荐、私人 FM 与云盘，QQ 音乐 / 酷狗账号配置                                         | [在线服务](https://sakura-player.pyabunny.com/integrations.html)                                                                                                   |
| 自建媒体源     | Subsonic / Navidrome / Jellyfin / Emby 等，多服务器、曲库同步、收藏与原文件下载                            | [流媒体服务](https://sakura-player.pyabunny.com/streaming.html)                                                                                                    |
| 歌词与 TTML    | TTML / LYS / QRC / KRC / YRC / LRC / ASS / SRT，翻译、音译、注音、在线与本地 TTML 库                       | [歌词功能](https://sakura-player.pyabunny.com/lyrics.html)                                                                                                         |
| AI 歌词辅助    | 自选文本模型生成翻译、音译、逐字翻译与逐字音译，支持补齐缺失、完整重做、流式预览与断点续译                 | [AI 功能](https://sakura-player.pyabunny.com/ai.html)                                                                                                              |
| 本地歌词对齐   | 按日语读音与跨语言语义，将已有翻译、音译映射到主歌词逐字时间轴，逐行预览并选择应用                         | [本地对齐](https://sakura-player.pyabunny.com/lyric-alignment.html)                                                                                                |
| 歌词展示与保存 | 桌面歌词、灵动岛、Windows 任务栏歌词，复制、歌词图片、保存前差异预览、标签 / LRC / TTML 保存               | [歌词保存](https://sakura-player.pyabunny.com/lyrics.html#复制、分享与保存)                                                                                        |
| 音效与播放工具 | 均衡器、音量均衡、倍速与变调、渐入渐出、下一曲预载、交叉过渡、AB 循环、定时停止、实时频谱                  | [播放与音效](https://sakura-player.pyabunny.com/playback.html)                                                                                                     |
| 听歌识曲       | 采集系统声音或麦克风，在本地生成指纹后在线匹配，可播放或搜索候选                                           | [识曲说明](https://sakura-player.pyabunny.com/integrations.html#听歌识曲)                                                                                          |
| 音乐下载       | 单曲 / 批量下载、音质与命名设置、标签和歌词写入、失败重试、下载记录与文件管理                              | [下载管理](https://sakura-player.pyabunny.com/music-downloads.html)                                                                                                |
| 系统与服务集成 | Windows SMTC / Linux MPRIS / macOS Now Playing、Last.fm、Discord RPC、全局快捷键与网络代理                 | [服务集成](https://sakura-player.pyabunny.com/integrations.html)                                                                                                   |
| 插件与外部控制 | 插件音源搜索、解析、元数据扩展和播放控制；可选 HTTP / WebSocket API，以及提供搜索与队列工具的独立 MCP 服务 | [插件](https://sakura-player.pyabunny.com/plugins/) · [HTTP API](https://sakura-player.pyabunny.com/api.html) · [MCP](https://sakura-player.pyabunny.com/mcp.html) |
| 外观与数据管理 | 封面取色、Light / Dark / Auto、多语言字体、布局与歌词样式、歌曲缓存、设置备份与恢复                        | [数据与备份](https://sakura-player.pyabunny.com/data-management.html)                                                                                              |

AI 歌词功能支持 OpenAI Compatible 与 Anthropic 协议，使用你配置的模型服务处理已有主歌词，不识别音频或重建原文时间轴。本地日语音译对齐开箱即用；本地翻译对齐首次需下载专用 Python 环境与模型，之后离线运行。应用歌词结果后仍需显式保存。

听歌识曲需要联网匹配，采集能力因平台而异：系统声音采集由 Windows / Linux 原生模块提供，麦克风可在原生采集不可用时使用浏览器采集路径。设置备份仅包含配置，不包含音乐库、歌单、历史或原音频。

## 歌曲高潮

播放器默认查询网易云的副歌标注与酷狗的高潮标注，复用现有登录会话；本地、QQ 音乐与流媒体歌曲通过元数据匹配。有标注时，进度条显示金色高潮区间，点击播放栏的 **火焰按钮** 即可跳转，普通、浮动和全屏布局均可使用。

可在 **设置 → 播放设置 → 播放控制 → 获取歌曲高潮** 中关闭。查询需要联网，依赖平台标注覆盖；没有结果或请求失败时可再次点击火焰按钮重试。不读取或上传音频文件，不进行本地音频分析。完整说明见[歌曲高潮](https://sakura-player.pyabunny.com/playback.html#歌曲高潮)。

## 下载与文档

- [下载页面](https://sakura-player.pyabunny.com/download.html)提供 Windows / macOS / Linux 的 x64 与 ARM64 安装包选择；请核对设备架构及安装形式
- [GitHub Releases](https://github.com/Sakura520222/Sakura-Player/releases)保留历史发行；[Nightly](https://github.com/Sakura520222/Sakura-Player/releases/tag/nightly)为独立滚动开发版
- 在 **设置 → 关于软件 → 更新** 中选择通道；应用内更新或手动下载安装取决于平台与安装形式，详见[更新说明](https://sakura-player.pyabunny.com/download.html#更新方式)
- 完整操作流程见[文档站](https://sakura-player.pyabunny.com/)与[使用指南](https://sakura-player.pyabunny.com/guide.html)；平台与服务功能也受账号权限和第三方接口可用性影响

## 开发

### 环境要求

- **Node.js** >= 22.19.0
- **pnpm** >= 10，优先使用 `package.json` 中 `packageManager` 指定的版本
- **Rust 与平台 C/C++ 工具链**；Windows 使用 Git Bash，Linux 需音频与媒体控制开发包，详见[贡献指南](https://sakura-player.pyabunny.com/contributing.html)

### 原生模块

核心性能特性由 Rust 编写的原生模块提供：

| 模块                | 说明                                               |
| ------------------- | -------------------------------------------------- |
| `audio-engine`      | 高性能音频解码（FFmpeg）、播放、FFT 频谱、封面提取 |
| `audio-capture`     | Windows / Linux 系统声音与麦克风采集               |
| `media-ctrl`        | 系统媒体控制 + Discord Rich Presence               |
| `taskbar-lyric`     | Windows 任务栏歌词原生渲染                         |
| `taskbar-thumbnail` | Windows 任务栏缩略图与 Peek 封面预览               |
| `opencc`            | 简繁、地区用字与日文字形转换                       |

`pnpm dev` 与 `pnpm build` 按平台自动编译对应原生模块。FFmpeg 随 `ffmpeg_audio` 静态构建，无需系统 FFmpeg。使用 `SKIP_NATIVE_BUILD=true` 只会跳过编译；原生能力仍需要匹配平台和架构的 `.node` 产物。详见[原生模块](https://sakura-player.pyabunny.com/native.html)。

### 快速开始

```bash
git clone https://github.com/Sakura520222/Sakura-Player.git
cd Sakura-Player

# 安装依赖
pnpm install

# 先以 debug 构建原生模块，再启动 Electron
pnpm dev
```

### 构建

```bash
pnpm build         # 完整构建：清理 → 原生模块 → 类型检查 → electron-vite

pnpm build:win     # 打包 Windows
pnpm build:mac     # 打包 macOS
pnpm build:linux   # 打包 Linux（AppImage / deb / rpm / tar.gz / pacman）
```

> 默认仅构建当前架构，暂不支持交叉编译。

### 其他脚本

```bash
pnpm typecheck        # tsc + vue-tsc（node + web 双目标）
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:native     # 仅构建 Rust 原生模块（加 `--dev` 为 debug 构建）
pnpm test             # Node、Web 与发行脚本测试
pnpm test:native      # Rust 工作区测试
pnpm docs:dev         # 本地文档站
pnpm docs:build       # 构建文档站
```

仅维护文档时可使用 `pnpm install --ignore-scripts`，无需编译 Rust 或重建 Electron 原生依赖。文档源位于 `docs/`，英文源位于 `docs/en/`。

## Fork 兼容与并存

- Windows 便携版将数据保存在 exe 同目录的 `SakuraPlayerData/`，不会改动上游的 `UserData/`。不会从旧共享目录自动迁移；如需复制，请先关闭两个应用、备份并确认数据归属。
- 新配置的 HTTP/WebSocket 默认端口为 `14568`，MCP 为 `14569`，仍保留开关与端口配置。已保存的端口不会被覆盖；请使用设置页的实际端口，导入配置发生冲突时为两个播放器选择不同端口。
- MCP 保留 `splayer://now-playing` 与 `splayer://library/summary`，作为新 `sakura-player://` 资源的兼容别名。`splayer` 插件 API 与原生模块别名继续兼容。客户端的 `sakura-player` 配置项与上游分开；连接两个服务时应分别配置端口和密钥。
- Windows 安装只加入“打开方式”，不抢占 `orpheus://`。在设置中主动开启 Orpheus 仍可能改变默认处理器，自动启动会保留已有处理器。关闭或卸载仅清理仍属于本安装的处理器，不承诺恢复此前的用户级选择。macOS 保留原协议声明，以兼容外部链接；两个应用并存时的 Launch Services 行为仍需实机验证。
- Discord RPC 默认关闭，暂时沿用上游 Application ID、素材与应用身份，不宣称独立的 Sakura Player Discord 品牌。独立品牌发行前，维护者必须注册真实应用并配置素材；本分支未虚构新 ID。

## 致谢

- [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) —— Sakura Player 的上游项目，由 imsyy 及 SPlayer-Dev 贡献者开发
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) —— 类 Apple Music 歌词显示组件库
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) —— 网易云音乐 API 备份 + 增强

## 开源许可

Sakura Player 继承自 SPlayer-Next，基于 [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html) 许可开源。原始许可正文保留于 [LICENSE](./LICENSE)，原作者声明与 Fork 来源保留于 [NOTICE](./NOTICE)。

- **修改与分发：** 遵循 **AGPL-3.0**，包括分发受许可作品或向用户提供修改版本的网络交互时适用的对应源码义务。仅进行私人修改并不当然要求公开发布。
- **派生作品：** 分发受许可作品时须遵循 **AGPL-3.0**，并保留适用的上游许可与版权声明。
- **署名：** 原始代码的著作权属于原作者 imsyy 及 SPlayer-Next 贡献者。Sakura Player 仅为二次开发添加了自己的说明，未移除或篡改任何原始信息。
- **源码获取：** 本分支源码在当前仓库维护。发行时须按 AGPL-3.0 提供该发行版本的完整对应源码。
- **免责：** 本软件按「现状」提供，不附带任何形式的担保，详见 AGPL-3.0。

## 免责声明

请遵守 AGPL-3.0 及所用第三方服务的条款，并确保有权访问、保存和使用相关音乐、歌词与其他内容。本软件不授予任何第三方内容权利，也不保证第三方接口持续可用。软件按许可证条款不提供担保；详情见[用户协议](https://sakura-player.pyabunny.com/agreement.html)与[隐私政策](https://sakura-player.pyabunny.com/privacy.html)。
