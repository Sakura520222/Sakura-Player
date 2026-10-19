# 原生歌词对齐

`lyric-alignment` 是播放器自带的独立 Rust 可执行文件，负责已有翻译和音译的分词、读音及语义对齐。通过标准输入输出传递有界 JSON，结束或取消任务时退出进程，不在 Electron 主进程常驻模型。

## 构建与验证

```bash
cargo build --locked -p lyric-alignment --release
cargo test --locked -p lyric-alignment
pnpm test:alignment
```

`pnpm build:native` 会构建并复制工作进程到 `native/lyric-alignment/bin/`，由 Electron Builder 发布到 `resources/native/`。平台与应用进程架构一致；CPU 后端不要求用户安装 Python、PyTorch、CUDA 或外部模型运行时。

Windows 工作进程单独启用静态 CRT，不依赖 VC++ 可再发行组件，不改变其他 NAPI 模块的链接方式。性能工具使用 `bin/` 中与播放器一起发布的同一个工作进程。

真实模型回归需要已经下载并校验的模型目录，不会在测试中自动下载：

```bash
RAYON_NUM_THREADS=2 SAKURA_ALIGNMENT_MODEL_DIR="模型目录" \
  cargo test --locked -p lyric-alignment --release \
  real_model_preserves_translation_alignment -- --ignored

cargo build --locked -p lyric-alignment --example measure
pnpm build:native
pnpm benchmark:alignment "模型目录"
```

性能工具运行固定的 28 行翻译及 71 行音译语料，各启动三次独立任务。它比较翻译文本和原词范围，保存全部结果、耗时和进程树工作集采样；Windows 同时读取根进程的系统峰值，覆盖短于采样周期的任务。输出位于 `build/lyric-alignment-benchmark/`。

## 兼容与资源

- `tests/fixtures/compatibility.json` 来自重写前提交 `5fbb528e` 的真实调用，包含 221 组读音、词典及翻译范围用例
- `tests/fixtures/semantic.json` 保存同一提交、同一 mBERT 权重的 28 行完整输入、分词、模型候选及最终输出
- FP32 mBERT 只计算第八层，不生成整句池化向量，不常驻全部隐藏层
- 权重从 safetensors 索引直接读入最终张量，避免整文件映射与张量副本同时进入工作集
- 原模型的 `LayerNorm.gamma/beta` 名称映射为 Candle 所需名称，权重文件无需转换
- 保留子词、完整词、实词、短语和基本形候选的优先级；语义阶段失败时整批翻译保持原样，音译仍可返回
- 词典和兼容数据仅在一次任务中存在，不使用全局无限缓存

## 数据与许可

`data/ipadic-compat.json.gz` 保存 Kuromoji 0.1.2 所带 IPADIC 的候选读音顺序和同分优先级，补齐更换日语实现后的兼容差异。它是静态词典数据，运行或构建播放器不依赖 JavaScript 词典包。

可使用 `node scripts/export-lyric-alignment-data.cjs <kuromoji-0.1.2-包目录>` 从原始发行包复现该文件。来源为 `mecab-ipadic-2.7.0-20070801`，版权与完整许可见 `licenses/IPADIC-NOTICE.txt` 和 `licenses/Kuromoji-LICENSE.txt`。

中日文词边界使用 ICU4X 的同源词典以及 ICU4C 最小词频代价与片假名代价规则的 Rust 实现。Unicode 许可见 `licenses/Unicode-LICENSE.txt`，参考实现为 Unicode ICU `dictbe.cpp`。SimAlign 的 IterMax 及相似度算法移植保留 MIT 许可，见 `licenses/SimAlign-LICENSE.txt`。其余 Rust 依赖分别遵循各自的许可证。
