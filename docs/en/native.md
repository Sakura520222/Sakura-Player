# Native Modules

Performance-sensitive features are implemented in **Rust**, compiled with [NAPI-RS](https://napi.rs/) into Node native addons, and loaded on demand by the main process. All modules live under `native/`.

## Modules

| Module              | Responsibility                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `audio-engine`      | FFmpeg decoding, rodio playback, FFT, and cover extraction                                            |
| `audio-capture`     | System/microphone capture on Windows and Linux for song recognition                                   |
| `media-ctrl`        | Windows SMTC, Linux MPRIS, macOS Now Playing, and Discord RPC                                         |
| `taskbar-lyric`     | Windows taskbar lyric rendering                                                                       |
| `taskbar-thumbnail` | Replaces Windows taskbar thumbnail and Peek preview with album art                                    |
| `opencc`            | Simplified/traditional, regional vocabulary, and Japanese character conversion through ferrous-opencc |

The repository contains six modules. The build script enables `audio-capture` on Windows/Linux, taskbar lyrics and thumbnails on Windows, and the remaining modules across platforms.

### audio-engine

- Decodes MP3, FLAC, WAV, AAC, OGG, APE, and more through `ffmpeg_audio`.
- Outputs through rodio with fades, speed/pitch control, loudness normalization, and an equalizer.
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

## Building

Install the **Rust toolchain** through [rustup](https://rustup.rs/). `pnpm dev` and `pnpm build` compile native modules automatically.

`ffmpeg_audio` statically builds FFmpeg, without system FFmpeg, `FFMPEG_DIR`, or FFmpeg pkg-config configuration. A platform C/C++ toolchain is still needed. Linux audio/media modules also require ALSA, D-Bus, PipeWire, and PulseAudio development packages; see [Contributing](/en/contributing).

```bash
pnpm build:native
pnpm build:native --dev
```

NAPI-RS generates each module's `index.d.ts`. The main process imports them through aliases:

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

Skipping compilation does not generate `.node` files. Native features still require existing binaries matching the current platform and architecture.

:::

::: warning Do not edit generated declarations
Do not edit `native/*/index.d.ts`. Import native types from `@splayer/*`.
:::
