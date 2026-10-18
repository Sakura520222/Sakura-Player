# 原生模块

Sakura Player 将性能敏感的能力下沉到 **Rust**，通过 [NAPI-RS](https://napi.rs/) 编译为 Node 原生插件（`.node`），由主进程按需加载。所有原生模块都位于仓库的 `native/` 目录。

## 模块一览

| 模块                | 职责                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| `audio-engine`      | 音频解码（FFmpeg）与播放（rodio）、FFT 频谱、封面提取                        |
| `audio-capture`     | Windows / Linux 系统声音与麦克风采集，供听歌识曲使用                         |
| `media-ctrl`        | 系统媒体控制（Windows SMTC / Linux MPRIS / macOS Now Playing）与 Discord RPC |
| `taskbar-lyric`     | Windows 任务栏歌词文字渲染                                                   |
| `taskbar-thumbnail` | Windows 任务栏悬停缩略图 / Peek 预览替换为专辑封面                           |
| `opencc`            | 基于 ferrous-opencc 的简繁、地区用字与日文字形转换                           |

仓库共六个模块。构建脚本按平台选择：`audio-capture` 仅在 Windows / Linux 构建，任务栏歌词和缩略图模块仅在 Windows 构建，其余模块跨平台构建。

### audio-engine

核心音频引擎，负责解码与播放：

- 使用 `ffmpeg_audio` crate 进行解码，支持 MP3、FLAC、WAV、AAC、OGG、APE 等格式；
- 基于 rodio 输出，支持渐入渐出、变速变调、音量均衡与均衡器；
- 实时 FFT 频谱数据，驱动可视化与歌词律动；
- 解码时同步提取封面缩略图；
- 在线音源通过 `ffmpeg_audio::HttpAudioSource`（配合 `HttpCancelHandle` 实现打断与 Seek 状态重置，基于 `reqwest` + `rustls`）以 `Read + Seek` 方式按需拉取，TLS 在 Rust 内处理，跨平台且无系统依赖。

### media-ctrl

跨平台的系统媒体集成：

- Windows SMTC、Linux MPRIS、macOS Now Playing；
- Discord Rich Presence（播放状态展示）。

### audio-capture

Windows 使用 WASAPI，Linux 使用 PulseAudio，输出供音频指纹处理的 8 kHz 单声道 PCM。macOS 不构建该模块，麦克风识曲可使用渲染进程的浏览器采集路径，见 [听歌识曲](/integrations#听歌识曲)。

### opencc

在主进程转换歌词文本，支持内置 OpenCC 配置和批量转换，无需单独安装系统 OpenCC。

### taskbar-lyric

Windows 任务栏歌词渲染，跟随系统主题与任务栏状态自适应。

### taskbar-thumbnail

Windows 任务栏缩略图自定义（仅 Windows）：

- 借助 DWM 的 iconic representation，把任务栏**悬停缩略图**与 **Peek 全尺寸预览**替换为指定图片（当前专辑封面），而非默认的实时窗口内容；
- 对主窗口子类化，被动应答 DWM 的位图请求，封面变化时通知 DWM 重新拉取。

## 构建

构建原生模块需要 **Rust 工具链**（通过 [rustup](https://rustup.rs/) 安装）。

`ffmpeg_audio` 静态编译 FFmpeg，不需要系统 FFmpeg、`FFMPEG_DIR` 或 FFmpeg 的 pkg-config 配置；编译仍需要平台的 C/C++ 工具链。Linux 的音频与媒体控制还需要 ALSA、D-Bus、PipeWire、PulseAudio 开发包，具体安装示例见 [贡献指南](/contributing)。

`pnpm dev` 与 `pnpm build` 会自动编译原生模块，通常无需手动操作：

```bash
# 仅构建原生模块（release）
pnpm build:native

# 构建 debug 版本（更快，便于调试）
pnpm build:native --dev
```

NAPI-RS 会自动生成各模块的 `index.d.ts` 类型声明，主进程通过路径别名引用：

```
@splayer/audio-engine      → native/audio-engine
@splayer/audio-capture     → native/audio-capture
@splayer/media-ctrl        → native/media-ctrl
@splayer/taskbar-lyric     → native/taskbar-lyric
@splayer/taskbar-thumbnail → native/taskbar-thumbnail
@splayer/opencc            → native/opencc
```

::: tip 跳过原生构建
如果当前只做界面（渲染层）开发、不需要原生能力，可设置环境变量 `SKIP_NATIVE_BUILD=true` 跳过 Rust 编译，加快启动：

```bash
SKIP_NATIVE_BUILD=true pnpm dev
```

跳过编译不会生成 `.node` 文件。需要使用原生能力时，仍须已有与本机平台、架构匹配的构建产物。

:::

::: warning 请勿手改类型声明
`native/*/index.d.ts` 由 NAPI-RS 自动生成，请勿手动编辑——主进程类型应从 `@splayer/*` 导入，而非自行声明。
:::
