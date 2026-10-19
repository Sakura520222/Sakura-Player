# 原生模块

Sakura Player 将性能敏感的能力下沉到 **Rust**。音频与系统集成通过 [NAPI-RS](https://napi.rs/) 编译为 Node 原生插件（`.node`），由主进程按需加载；算法智能对齐运行在独立的 Rust 工作进程中。源码均位于仓库的 `native/` 目录。

## 模块一览

| 模块                | 职责                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| `audio-engine`      | 音频解码（FFmpeg）与播放（rodio）、FFT 频谱、封面提取                        |
| `audio-capture`     | Windows / Linux 系统声音与麦克风采集，供听歌识曲使用                         |
| `media-ctrl`        | 系统媒体控制（Windows SMTC / Linux MPRIS / macOS Now Playing）与 Discord RPC |
| `taskbar-lyric`     | Windows 任务栏歌词文字渲染                                                   |
| `taskbar-thumbnail` | Windows 任务栏悬停缩略图 / Peek 预览替换为专辑封面                           |
| `opencc`            | 基于 ferrous-opencc 的简繁、地区用字与日文字形转换                           |
| `lyric-alignment`   | 独立工作进程，完成已有翻译与音译的分词、读音匹配和本地语义推理               |

仓库包含六个 NAPI 模块和一个独立工作进程。构建脚本按平台选择：`audio-capture` 仅在 Windows / Linux 构建，任务栏歌词和缩略图模块仅在 Windows 构建，其余模块与对齐工作进程跨平台构建。

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

### lyric-alignment

[算法智能对齐](/lyric-alignment)使用独立可执行文件，通过标准输入输出传递有界 JSON。Rust 完成日语词典读音、中文拼音、时间范围匹配以及 Candle 多语言 BERT 推理，无需 Python、PyTorch、CUDA 或外部模型运行时。

每个任务单独启动进程，结束或取消后释放词典、模型和计算线程。Electron 主进程负责模型管理、输入输出校验和取消控制，渲染进程保留现有预览、应用与保存流程。Windows 工作进程静态链接 CRT；其他 NAPI 模块沿用各自的链接方式。

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

上述命令同时构建对齐工作进程并复制到 `native/lyric-alignment/bin/`，打包时放入应用的 `resources/native/`。用户下载的模型保存在独立的数据目录，见[模型管理](/lyric-alignment#模型下载与移除)。

六个 NAPI 模块自动生成各自的 `index.d.ts` 类型声明，主进程通过路径别名引用：

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

跳过编译不会生成 `.node` 文件或对齐工作进程。需要使用原生能力时，仍须已有与本机平台、架构匹配的构建产物。

:::

::: warning 请勿手改类型声明
`native/*/index.d.ts` 由 NAPI-RS 自动生成，请勿手动编辑——主进程类型应从 `@splayer/*` 导入，而非自行声明。
:::

## 对齐验证

### 测试与复现

```bash
# Rust 算法、主进程集成与歌词应用回归
pnpm test:alignment

# 显式运行真实模型回归，模型须已下载并校验
RAYON_NUM_THREADS=2 SAKURA_ALIGNMENT_MODEL_DIR="模型目录" \
  cargo test --locked -p lyric-alignment --release \
  real_model_preserves_translation_alignment -- --ignored

# 测量与播放器一起发布的工作进程
cargo build --locked -p lyric-alignment --example measure
pnpm build:native
pnpm benchmark:alignment "模型目录"
```

模型目录应包含模型文件本身，例如 `{userData}/app-data/runtimes/lyric-alignment/model/`。测试和性能脚本不会自动下载模型，性能报告输出到 `build/lyric-alignment-benchmark/`。

### 已完成的验证

2026-10-19 在 Windows x64 上完成：

- 221 组重写前实现的词典、读音与范围用例通过，固定模型的 28 行翻译结果与重写前一致
- 递归检查 240 首真实音乐，其中 114 首满足条件、共 4,232 行执行重对齐，无运行异常；其余 120 首缺少必要输入，6 首无歌词
- 112 首产生候选并通过实际应用轨道的保存重读检查，2 首无可靠候选并保留原内容
- 90 首曲目共 3,492 个音译输入行（含空音译项）与重写前实现对照，最终文本切片和原词范围零差异
- 所有 240 首原文件的 SHA-256、大小与修改时间一致，批量验证未改写原文件
- JavaScript 与发布脚本测试 1,294 项、Rust 工作区测试 129 项通过；真实模型测试另行执行通过，并完成应用内模型准备、预览、应用、取消及 Windows 打包检查

### 性能样本

硬件为 AMD Ryzen 9 8940HX、32 个逻辑处理器、31.2 GiB 内存。新旧流程使用相同模型和输入、2 个 CPU 推理线程，各启动三次独立进程，取中位数。内存记录进程树峰值工作集，Windows 同时读取根进程的系统峰值；新版使用实际打包的静态 CRT 工作进程。

| 任务      | 重写前耗时 | Rust 耗时 | 重写前峰值内存 | Rust 峰值内存 |
| --------- | ---------- | --------- | -------------- | ------------- |
| 28 行翻译 | 30.214 秒  | 3.982 秒  | 868.0 MiB      | 619.8 MiB     |
| 71 行音译 | 0.956 秒   | 0.253 秒  | 481.9 MiB      | 42.6 MiB      |

本机翻译样本约快 7.6 倍，音译样本约快 3.8 倍。结果包含工作进程启动与资源加载，实际耗时取决于硬件、歌词长度和内容。

构建目标覆盖 Windows、macOS、Linux 的 x64/ARM64，本次实际运行验证仅限 Windows x64。候选匹配覆盖率不代表人工语义正确率。另有 6 首的未重对齐对照导出同样发生原有空白归一化或背景句重新分段，实际应用的原生对齐轨道已独立核对，不计作新增对齐差异。
