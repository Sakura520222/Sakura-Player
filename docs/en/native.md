# Native Modules

Performance-sensitive features are implemented in **Rust**. The main process loads [NAPI-RS](https://napi.rs/) addons for audio and system integration on demand. Algorithmic lyric alignment and AutoMix inference each run in a dedicated Rust worker. The sources live under `native/`.

## Modules

| Module              | Responsibility                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `audio-engine`      | FFmpeg decoding, rodio playback, FFT, and cover extraction                                                      |
| `audio-capture`     | System/microphone capture on Windows and Linux for song recognition                                             |
| `media-ctrl`        | Windows SMTC, Linux MPRIS, macOS Now Playing, and Discord RPC                                                   |
| `taskbar-lyric`     | Windows taskbar lyric rendering                                                                                 |
| `taskbar-thumbnail` | Replaces Windows taskbar thumbnail and Peek preview with album art                                              |
| `opencc`            | Simplified/traditional, regional vocabulary, and Japanese character conversion through ferrous-opencc           |
| `lyric-alignment`   | Independent worker for acoustic primary-lyric timing, semantic translation alignment, and romanization matching |
| `automix-worker`    | Independent worker for beat detection and stem separation through ONNX Runtime                                  |

The build script enables `audio-capture` on Windows/Linux, taskbar lyrics and thumbnails on Windows, and the remaining addons and lyric alignment worker across platforms.

### audio-engine

- Decodes MP3, FLAC, WAV, AAC, OGG, APE, and more through `ffmpeg_audio`.
- Supports fades, speed and pitch control, loudness normalization, and EQ in the standard path. Windows also offers a dedicated WASAPI exclusive direct path.
- Reads local tags and sample parameters, analyzes source spectra, and supports time ranges from external and embedded CUE sheets.
- Produces realtime FFT data for visualizations and lyric motion.
- Extracts cover thumbnails while decoding.
- Streams remote audio through `ffmpeg_audio::HttpAudioSource`. `HttpCancelHandle` supports immediate cancellation and seek reset, while `reqwest` and `rustls` handle TLS without system FFmpeg dependencies.

### media-ctrl

Provides system media controls on Windows, Linux, and macOS, plus Discord Rich Presence.

### audio-capture

Uses WASAPI on Windows and PulseAudio on Linux, supplying 8 kHz mono PCM for fingerprints. It is not built on macOS, where microphone recognition can use renderer browser capture. See [Song recognition](/en/integrations#song-recognition).

### opencc

Converts lyric text in the main process using built-in OpenCC configurations and batch conversion, without requiring a system OpenCC installation.

### taskbar-lyric

Renders lyrics in the Windows taskbar and adapts to theme and taskbar state.

### taskbar-thumbnail

Uses DWM iconic representation on Windows to replace the taskbar hover thumbnail and full-size Peek preview with album artwork.

### lyric-alignment

[Algorithmic lyric alignment](/en/lyric-alignment) uses an independent executable with bounded JSON over standard input and output. Primary timing reuses the audio engine's FFmpeg decoder and AutoMix's ONNX Runtime for MMS_FA and CTC alignment. Auxiliary alignment uses Rust dictionaries, reading and range matching, and multilingual BERT through Candle for translation.

Each task starts a separate process and releases dictionaries, model memory, and threads when completed or cancelled. The Electron main process manages the model, validates requests and responses, and controls cancellation. The renderer retains the existing preview, apply, and save workflow. The Windows worker statically links the CRT; other NAPI addons keep their existing linking configuration.

### automix-worker

[AutoMix](/en/automix) uses ONNX Runtime in a dedicated Rust worker for beat detection and stem separation. The main process uses the analysis to plan the transition, which the audio engine mixes. The script `scripts/package-automix-runtime.ts` packages the worker separately with the AutoMix analysis runtime downloaded through Settings.

## Building

Install the **Rust toolchain** through [rustup](https://rustup.rs/). `pnpm dev` and `pnpm build` compile native modules automatically.

`ffmpeg_audio` statically builds FFmpeg, without system FFmpeg, `FFMPEG_DIR`, or FFmpeg pkg-config configuration. A platform C/C++ toolchain is still needed. Linux audio/media modules also require ALSA, D-Bus, PipeWire, and PulseAudio development packages; see [Contributing](/en/contributing).

```bash
pnpm build:native
pnpm build:native --dev
```

These commands also build the alignment worker and copy it to `native/lyric-alignment/bin/`. Packaging places it under the application's `resources/native/`. Downloaded models live separately in user data; see [Model management](/en/lyric-alignment#model-management).

NAPI-RS generates `index.d.ts` for the six addons. The main process imports them through aliases:

```text
@splayer/audio-engine      → native/audio-engine
@splayer/audio-capture     → native/audio-capture
@splayer/media-ctrl        → native/media-ctrl
@splayer/taskbar-lyric     → native/taskbar-lyric
@splayer/taskbar-thumbnail → native/taskbar-thumbnail
@splayer/opencc            → native/opencc
```

::: tip Skipping native builds
For renderer-only work, set `SKIP_NATIVE_BUILD=true`:

```bash
SKIP_NATIVE_BUILD=true pnpm dev
```

Skipping compilation does not generate `.node` files or the alignment worker. Native features still require existing binaries matching the current platform and architecture.

:::

::: warning Do not edit generated declarations
Do not edit `native/*/index.d.ts`. Import native types from `@splayer/*`.
:::

## Alignment validation

See the [acoustic alignment validation record](https://github.com/Sakura520222/Sakura-Player/blob/dev/native/lyric-alignment/ACOUSTIC_VALIDATION.md) for singing samples, warnings, and reproduction commands for primary timing. The checks below cover auxiliary lyric alignment.

### Tests and reproduction

Run the following commands from the repository root:

```bash
pnpm test:alignment

RAYON_NUM_THREADS=2 SAKURA_ALIGNMENT_MODEL_DIR="model-directory" \
  cargo test --locked -p lyric-alignment --release \
  real_model_preserves_translation_alignment -- --ignored

cargo build --locked -p lyric-alignment --example measure
pnpm build:native
pnpm benchmark:alignment "model-directory"
```

Use the directory containing model files, such as `{userData}/app-data/runtimes/lyric-alignment/model/`. Tests and benchmarks do not download the model. The benchmark measures the worker shipped with the player and writes reports under `build/lyric-alignment-benchmark/`.

### Completed checks

Validation on 2026-10-19 used Windows x64:

- All 221 dictionary, reading, and range cases captured before the rewrite passed; the pinned model's 28 translation outputs matched the implementation before the rewrite
- All 240 music files were inspected; 114 eligible tracks with 4,232 rows were realigned without execution errors, while 120 lacked required input and 6 had no lyrics
- 112 tracks produced candidates and passed save/reload checks of the applied auxiliary tracks; 2 had no reliable candidates and retained existing content
- Comparing 3,492 romanization input rows across 90 tracks, including empty romanization entries, found no differences in final text slices or original word ranges
- SHA-256, size, and modification time matched for all 240 original files; batch validation did not rewrite them
- All 1,294 JavaScript/release-script tests and 129 Rust workspace tests passed; the real-model test passed separately, alongside model preparation, preview, apply, cancellation, and Windows packaging checks

### Performance sample

Hardware: AMD Ryzen 9 8940HX, 32 logical processors, and 31.2 GiB RAM. Both implementations used the same model, inputs, and two CPU inference threads. Each workload ran in three fresh processes; values below are medians. Memory records peak process-tree working set, supplemented by the Windows root process's system peak. The Rust measurements use the packaged worker with static CRT linking.

| Task                 | Time before rewrite | Rust time | Peak memory before rewrite | Rust peak memory |
| -------------------- | ------------------- | --------- | -------------------------- | ---------------- |
| 28 translation rows  | 30.214 s            | 3.982 s   | 868.0 MiB                  | 619.8 MiB        |
| 71 romanization rows | 0.956 s             | 0.253 s   | 481.9 MiB                  | 42.6 MiB         |

Translation was about 7.6 times faster in this sample; romanization was about 3.8 times faster. Measurements include process startup and resource loading. Actual time depends on hardware, lyric length, and content.

Build targets cover Windows, macOS, and Linux on x64/ARM64; actual runtime validation here is limited to Windows x64. Candidate coverage is not human-rated semantic accuracy. Six tracks also showed existing whitespace normalization or background-line regrouping in control exports without realignment. Applied native auxiliary tracks were checked separately; these existing serialization differences are not counted as new alignment differences.
