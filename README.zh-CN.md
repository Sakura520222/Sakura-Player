<div align="center">

<img alt="Sakura Player logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>Sakura Player</h2>

<p>🎵 跨平台桌面音乐播放器，支持丰富的歌词展现形式与广泛的音频格式</p>

<p>基于 <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a> 的非官方二次开发版本，由 <a href="https://github.com/Sakura520222">Sakura520222</a> 维护</p>

[![Stars](https://img.shields.io/github/stars/Sakura520222/Sakura-Player?style=flat)](https://github.com/Sakura520222/Sakura-Player/stargazers)
[![Release](https://img.shields.io/github/v/release/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/releases)
[![License](https://img.shields.io/github/license/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/issues)

[English](./README.md) | **简体中文**

</div>

---

> [!NOTE]
> Sakura Player 是社区维护的非官方分支，与 SPlayer-Next 官方项目无隶属关系。
> 上游原版由 [imsyy](https://github.com/imsyy) 与 [SPlayer-Dev](https://github.com/SPlayer-Dev) 组织开发，仓库地址为 <https://github.com/SPlayer-Dev/SPlayer-Next>。
> Sakura Player 可与上游原版独立安装、并存使用，并独立管理自己的用户数据。
> Fork 修改日期：**2026-10-13**。上游版权声明与来源信息保留于 [NOTICE](./NOTICE)。

## Fork 兼容与并存

- Windows 便携版将数据保存在 exe 同目录的 `SakuraPlayerData/`，不会改动上游的 `UserData/`。不会从旧共享目录自动迁移；如需复制，请先关闭两个应用、备份并确认数据归属。
- 新配置的 HTTP/WebSocket 默认端口为 `14568`，MCP 为 `14569`，仍保留开关与端口配置。已保存的端口不会被覆盖；请使用设置页的实际端口，导入配置发生冲突时为两个播放器选择不同端口。
- MCP 保留 `splayer://now-playing` 与 `splayer://library/summary`，作为新 `sakura-player://` 资源的兼容别名。`splayer` 插件 API 与原生模块别名继续兼容。客户端的 `sakura-player` 配置项与上游分开；连接两个服务时应分别配置端口和密钥。
- Windows 安装只加入“打开方式”，不抢占 `orpheus://`。在设置中主动开启 Orpheus 仍可能改变默认处理器，自动启动会保留已有处理器。关闭或卸载仅清理仍属于本安装的处理器，不承诺恢复此前的用户级选择。macOS 保留原协议声明，以兼容外部链接；两个应用并存时的 Launch Services 行为仍需实机验证。
- Discord RPC 默认关闭，暂时沿用上游 Application ID、素材与应用身份，不宣称独立的 Sakura Player Discord 品牌。独立品牌发行前，维护者必须注册真实应用并配置素材；本分支未虚构新 ID。

## 功能特性

- 🎵 **广泛的格式支持** —— MP3、FLAC、WAV、AAC、OGG、APE 等，基于 FFmpeg 解码
- 📝 **丰富的歌词** —— LRC / QRC / YRC / TTML，逐字高亮与翻译，支持桌面、灵动岛、任务栏歌词窗口
- 🌐 **流媒体服务** —— Subsonic / Navidrome / Jellyfin / Emby（多服务器、自动连接）
- 🖥️ **跨平台** —— Windows / macOS / Linux
- 🎚️ **音乐频谱** —— 实时 FFT 可视化
- 🏷️ **元信息编辑** —— 编辑本地曲目标签与封面
- ⬇️ **下载** —— 内置下载管理器
- 🎧 **系统媒体集成** —— Windows SMTC / Linux MPRIS / macOS Now Playing + Discord RPC
- ⚡ **高性能音频引擎** —— FFmpeg + Rust
- 🎨 **自适应主题** —— 基于封面取色，Light / Dark / Auto
- 📈 **Last.fm Scrobble**

## 开发

### 环境要求

- **Node.js** >= 22
- **pnpm** >= 10
- **Rust 工具链**（构建原生模块所需，见下）

### 原生模块

核心性能特性由 Rust 编写的原生模块提供：

| 模块            | 说明                                               |
| --------------- | -------------------------------------------------- |
| `audio-engine`  | 高性能音频解码（FFmpeg）、播放、FFT 频谱、封面提取 |
| `media-ctrl`    | 系统媒体控制 + Discord Rich Presence               |
| `taskbar-lyric` | Windows 任务栏歌词原生渲染                         |

`pnpm dev` 与 `pnpm build` 会自动编译原生模块。若只做 UI 开发想跳过，可设置 `SKIP_NATIVE_BUILD=true`。

### 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 启动开发（先以 debug 构建原生模块，再启动 Electron）
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
```

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

本项目仅供个人学习与研究使用，禁止用于商业及非法用途。部分功能依赖第三方 API，使用者须自行确保其使用符合相关法律法规及服务协议。对于因使用本项目而产生的任何直接或间接后果，作者不承担任何责任。
