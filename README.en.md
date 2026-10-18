<div align="center">

<img alt="Sakura Player logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>Sakura Player</h2>

<p>🎵 A cross-platform desktop music player for local libraries, self-hosted media, timed lyrics, and AI lyric assistance.</p>

<p>An unofficial fork of <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a>, maintained by <a href="https://github.com/Sakura520222">Sakura520222</a>.</p>

[![Stars](https://img.shields.io/github/stars/Sakura520222/Sakura-Player?style=flat)](https://github.com/Sakura520222/Sakura-Player/stargazers)
[![Release](https://img.shields.io/github/v/release/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/releases)
[![License](https://img.shields.io/github/license/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/issues)

[简体中文](./README.md) | **English**

[Download](https://sakura-player.pyabunny.com/en/download.html) · [User Guide](https://sakura-player.pyabunny.com/en/guide.html) · [AI Features](https://sakura-player.pyabunny.com/en/ai.html) · [Report an Issue](https://github.com/Sakura520222/Sakura-Player/issues)

</div>

---

> [!NOTE]
> Sakura Player is a community-maintained fork and is **not** affiliated with the official SPlayer-Next project.
> The original upstream version is developed by [imsyy](https://github.com/imsyy) and the
> [SPlayer-Dev](https://github.com/SPlayer-Dev) organization at <https://github.com/SPlayer-Dev/SPlayer-Next>.
> Sakura Player installs side-by-side with the upstream app and manages its own user data.
> Fork modifications date: **2026-10-13**. Upstream copyright and provenance are retained in [NOTICE](./NOTICE).

## Features Added Compared with Upstream

This comparison covers Sakura Player **v1.2.0-beta.4** against upstream **`dev` as of 2026-10-18 ([`aa460b50`](https://github.com/SPlayer-Dev/SPlayer-Next/commit/aa460b502639167c82d4fb7e06ce10f9f744d11b))**. Feature attribution below refers to that baseline.

### Features Added by This Fork

| Feature                                                                                                  | Additions in Sakura Player                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Song highlight lookup and seeking](https://sakura-player.pyabunny.com/en/playback.html#song-highlights) | Query NetEase chorus and Kugou highlight annotations, show gold progress bands, and jump with the flame button. Supports multiple ranges, regular / floating / full-screen layouts, and metadata matching for local, QQ Music, and streaming tracks.                                                                                                  |
| [AI lyric translation and generation](https://sakura-player.pyabunny.com/en/ai.html)                     | Choose translation, romanization, word-aligned translation, and word-aligned romanization. Supports Simplified Chinese, Traditional Chinese, English, Japanese, and Korean translations, with fill-missing and regenerate modes that preserve unselected auxiliary tracks.                                                                            |
| AI model requests and resumable generation                                                               | Extend upstream's existing model configuration with actual OpenAI-compatible / Anthropic text requests, connection tests, streamed previews, cancellation, and reasoning-effort settings for compatible services. Resume after failure or cancellation within the current dialog session.                                                             |
| [Local lyric alignment](https://sakura-player.pyabunny.com/en/lyric-alignment.html)                      | Map existing translation and romanization to primary word timings without a model API key, with realignment, per-line previews, and selective application. Japanese romanization works immediately; translation alignment includes dedicated runtime/model installation, background downloads, cancellation, retries, and removal, then runs offline. |
| [Complete lyric saving](https://sakura-player.pyabunny.com/en/lyrics.html#copy-share-and-save)           | Add whole-song saving to the copy dialog: write tags in standalone local audio, export LRC, or save eligible TTML. Audio tags preserve the primary lyric format and auxiliary tracks, with save/reload support for romanization ranges spanning multiple source words.                                                                                |
| Pre-save lyric diffs                                                                                     | Compare existing and proposed lyrics for audio-tag, LRC, and TTML targets, showing added/removed lines, format changes, and target paths when known.                                                                                                                                                                                                  |
| Copy liked-song lists                                                                                    | Copy the entire currently filtered and sorted list from Liked Songs as “Title - Artist”, in the same order shown on screen.                                                                                                                                                                                                                           |
| Hide Dynamic Island when paused                                                                          | Optionally hide it when playback pauses and show it again on resume, retaining its window position.                                                                                                                                                                                                                                                   |

AI generation and local alignment process existing lyric text and reuse primary timings; they do not transcribe audio or rebuild the primary timeline. Apply results, then explicitly save them to persist changes. LRC exports translations by line; preserving word-aligned translations requires audio tags or eligible TTML. Song highlights use online platform annotations, and plugin-source tracks do not participate.

### Experience and Maintenance Improvements by This Fork

- **Lyric display:** add word-aligned translation highlighting and improve wrapped auxiliary highlighting, cross-word romanization mapping, centered romanization, and immediate refresh after applying changes in both the default and AMLL engines.
- **Audio output:** add short smoothing ramps at output boundaries, improve asynchronous output-stream cleanup, and stop old output streams promptly when switching tracks.
- **Independent releases and coexistence:** separate app identifiers, installation names, user data, and update feeds; use `SakuraPlayerData/` for portable builds and distinct default service ports while retaining plugin and MCP compatibility. See [Fork compatibility](#fork-compatibility).
- **Updates and maintenance:** derive the initial update channel from the installed version while preserving saved choices; improve release-asset validation, native-build retries, list headers, and bilingual documentation, and pin this repository's owner in the contributor list.

### Features Inherited or Synced from Upstream

FFmpeg / Rust decoding, CUE segments, local libraries and playlists, listening statistics, online music, self-hosted media, song recognition, downloads, basic lyric formats and word-timed display, desktop lyrics / Dynamic Island / Windows taskbar lyrics, system media controls, plugins, HTTP / WebSocket APIs, and MCP are inherited from [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next). Thanks to imsyy and the upstream contributors.

The streaming subsystem refactor, plugin and MCP extensions, playback-page screen-awake settings, Kugou list pagination fixes, and the separate translation / romanization font size already available upstream are classified as existing or synced upstream improvements.

## Features

The overview below includes both inherited capabilities and additions by this fork; attribution is described above.

| Feature                        | Capabilities                                                                                                                                                      | Guide                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audio playback                 | FFmpeg + Rust decoding for MP3, FLAC, WAV, AAC, OGG, APE, and more, including CUE segments                                                                        | [Playback](https://sakura-player.pyabunny.com/en/playback.html)                                                                                                                |
| Library and playlists          | Folder scanning, track/artist/album/folder browsing, local playlists, likes, history, and listening statistics                                                    | [Library](https://sakura-player.pyabunny.com/en/library.html)                                                                                                                  |
| Tags and artwork               | Edit titles, artists, albums, and covers in standalone local audio, with batch management                                                                         | [Metadata editing](https://sakura-player.pyabunny.com/en/library.html#tags-and-artwork)                                                                                        |
| Online music                   | NetEase likes, collections, daily recommendations, Personal FM, and cloud library; QQ Music/Kugou account configuration                                           | [Online services](https://sakura-player.pyabunny.com/en/integrations.html)                                                                                                     |
| Self-hosted media              | Subsonic, Navidrome, Jellyfin, Emby, and compatible servers, with multiple servers, index sync, favorites, and original-file downloads                            | [Streaming](https://sakura-player.pyabunny.com/en/streaming.html)                                                                                                              |
| Lyrics and TTML                | TTML / LYS / QRC / KRC / YRC / LRC / ASS / SRT, translation, romanization, ruby, and online/local TTML libraries                                                  | [Lyrics](https://sakura-player.pyabunny.com/en/lyrics.html)                                                                                                                    |
| AI lyric assistance            | Your chosen text model generates translation, romanization, and word-aligned auxiliary content, with fill-missing/regenerate modes, streamed previews, and resume | [AI features](https://sakura-player.pyabunny.com/en/ai.html)                                                                                                                   |
| Local lyric alignment          | Use Japanese readings and cross-language semantics to map existing auxiliary text to primary word timings, then preview and select candidates                     | [Local alignment](https://sakura-player.pyabunny.com/en/lyric-alignment.html)                                                                                                  |
| Lyric display and saving       | Desktop lyrics, Dynamic Island, Windows taskbar lyrics, copying, lyric images, pre-save diffs, and tag/LRC/TTML saving                                            | [Save lyrics](https://sakura-player.pyabunny.com/en/lyrics.html#copy-share-and-save)                                                                                           |
| Audio effects and tools        | Equalizer, normalization, speed/pitch, fades, preloading, crossfade, A-B loop, sleep timer, and realtime spectrum                                                 | [Playback and effects](https://sakura-player.pyabunny.com/en/playback.html)                                                                                                    |
| Song recognition               | Capture system or microphone audio, generate fingerprints locally, match online, and play or search candidates                                                    | [Recognition](https://sakura-player.pyabunny.com/en/integrations.html#song-recognition)                                                                                        |
| Music downloads                | Single/batch tasks, quality/naming options, tag/lyric writing, retries, and record/file management                                                                | [Downloads](https://sakura-player.pyabunny.com/en/music-downloads.html)                                                                                                        |
| System and service integration | Windows SMTC, Linux MPRIS, macOS Now Playing, Last.fm, Discord RPC, global shortcuts, and proxy configuration                                                     | [Integrations](https://sakura-player.pyabunny.com/en/integrations.html)                                                                                                        |
| Plugins and external control   | Plugin search, source resolution, metadata, and playback control; optional HTTP/WebSocket APIs plus a separate MCP service with search and queue tools            | [Plugins](https://sakura-player.pyabunny.com/en/plugins/) · [HTTP API](https://sakura-player.pyabunny.com/en/api.html) · [MCP](https://sakura-player.pyabunny.com/en/mcp.html) |
| Appearance and data            | Cover-driven colors, Light/Dark/Auto, multilingual fonts, layouts and lyric styling, song caches, settings backup/restore                                         | [Data and backups](https://sakura-player.pyabunny.com/en/data-management.html)                                                                                                 |

AI lyrics support OpenAI-compatible and Anthropic protocols, using your configured model service to process existing primary lyrics without transcribing audio or rebuilding primary timing. Local Japanese romanization alignment works immediately. Local translation alignment first downloads its dedicated Python environment and model, then runs offline. Applying results still requires an explicit save to write files.

Recognition requires online matching and depends on platform capture capabilities. Native system capture is available on Windows/Linux; microphone capture can use the browser when native capture is unavailable. Settings backups contain configuration, not the library, playlists, history, or original audio.

## Song highlights

The player automatically queries NetEase's chorus annotations and Kugou's highlight annotations, reusing existing login sessions. Local, QQ Music, and streaming tracks are matched by metadata. Gold bands show available highlight ranges on the progress bar; click the **flame button** to jump to a highlight in the regular, floating, or full-screen player.

Disable this feature in **Settings → Player → Playback control → Find Song Highlights**. Queries require a network connection and depend on platform annotation coverage. Click the flame button again to retry an empty or failed lookup. Audio files are not read or uploaded, and local audio analysis is not performed. See [Song highlights](https://sakura-player.pyabunny.com/en/playback.html#song-highlights) for details.

## Downloads and Documentation

- The [download page](https://sakura-player.pyabunny.com/en/download.html) offers x64/ARM64 packages for Windows, macOS, and Linux. Check your architecture and installation form.
- Browse historical releases on [GitHub Releases](https://github.com/Sakura520222/Sakura-Player/releases). [Nightly](https://github.com/Sakura520222/Sakura-Player/releases/tag/nightly) is a separate rolling development release.
- Choose a channel in **Settings → About → Update**. In-app versus manual updates depend on platform and installation form; see [update methods](https://sakura-player.pyabunny.com/en/download.html#update-methods).
- See the [documentation site](https://sakura-player.pyabunny.com/en/) and [user guide](https://sakura-player.pyabunny.com/en/guide.html) for workflows. Account permissions and third-party availability also determine which service features work.

## Development

### Requirements

- **Node.js** >= 22.19.0
- **pnpm** >= 10; prefer the version declared by `packageManager` in `package.json`
- **Rust and platform C/C++ toolchains**; use Git Bash on Windows. Linux needs audio/media development packages. See [Contributing](https://sakura-player.pyabunny.com/en/contributing.html).

### Native Modules

Core performance features are powered by Rust-based native modules:

| Module              | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `audio-engine`      | High-performance audio decoding (FFmpeg), playback, FFT spectrum, cover extraction |
| `audio-capture`     | Windows/Linux system and microphone capture                                        |
| `media-ctrl`        | System media controls + Discord Rich Presence                                      |
| `taskbar-lyric`     | Native Windows taskbar lyric rendering                                             |
| `taskbar-thumbnail` | Windows taskbar thumbnail and Peek artwork previews                                |
| `opencc`            | Simplified/traditional, regional vocabulary, and Japanese character conversion     |

`pnpm dev` and `pnpm build` compile the modules enabled for your platform. `ffmpeg_audio` statically builds FFmpeg without a system FFmpeg installation. `SKIP_NATIVE_BUILD=true` skips compilation but does not supply native binaries; native features still require matching `.node` outputs. See [Native Modules](https://sakura-player.pyabunny.com/en/native.html).

### Getting Started

```bash
git clone https://github.com/Sakura520222/Sakura-Player.git
cd Sakura-Player
pnpm install
pnpm dev
```

### Building

```bash
pnpm build
pnpm build:win
pnpm build:mac
pnpm build:linux
```

The full build cleans output, compiles native modules, checks types, and runs electron-vite. Linux packages include AppImage, deb, rpm, tar.gz, and pacman.

> By default a build targets the current architecture only. Cross-compilation is not supported.

### Other Scripts

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm build:native
pnpm test
pnpm test:native
pnpm docs:dev
pnpm docs:build
```

Add `--dev` to `build:native` for debug output. For documentation-only work, use `pnpm install --ignore-scripts` without Rust compilation or Electron native dependency rebuilding. Sources live in `docs/` and `docs/en/`.

## Fork compatibility

- Windows portable builds store data in `SakuraPlayerData/` beside the executable. The upstream `UserData/` directory is left untouched. There is no automatic migration from that shared directory; back it up and identify the data you intend to copy with both applications closed.
- Fresh configurations use port `14568` for HTTP/WebSocket and `14569` for MCP. Both services remain optional and configurable. Saved ports are preserved; use the actual Settings values and choose different ports if imported settings conflict with another player.
- MCP keeps `splayer://now-playing` and `splayer://library/summary` as aliases of the new `sakura-player://` resources. The `splayer` plugin API and native module aliases remain compatible. The `sakura-player` client configuration entry is separate from upstream; configure a distinct port and key when using both servers.
- Windows installation adds file handlers to Open With and does not take over `orpheus://`. Explicitly enabling Orpheus in Settings can change its default handler; automatic startup preserves an existing handler. Disabling or uninstalling only removes a handler still owned by this installation and does not promise to restore a previous user-level choice. macOS declares the existing scheme so external links remain compatible; Launch Services behavior still needs verification with both apps installed.
- Discord RPC is disabled by default and temporarily uses the upstream Application ID, assets, and identity. It makes no independent Sakura Player brand claim. Before an independently branded Discord release, the maintainer must register a real application and supply its assets; no new ID is invented here.

## Acknowledgements

- [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) — the upstream project Sakura Player is based on, developed by imsyy and the SPlayer-Dev contributors
- [applemusic-like-lyrics](https://github.com/Steve-xmh/applemusic-like-lyrics) — Apple Music-style lyrics display component library
- [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) — NetEase Cloud Music API (backup + enhanced)

## License

Sakura Player is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html), inherited from SPlayer-Next. The original license text is retained in [LICENSE](./LICENSE), and original author notices and fork provenance are retained in [NOTICE](./NOTICE).

- **Modification & distribution:** follow **AGPL-3.0**, including its corresponding-source requirements when distributing covered works or offering a modified version for remote network interaction. Private modification does not by itself require public release.
- **Derivative works:** distributed covered works must comply with **AGPL-3.0** and retain applicable upstream license and copyright notices.
- **Attribution:** the original author (imsyy) and the SPlayer-Next contributors hold the copyright to the original code. Sakura Player adds its own notices for the fork but does not remove or alter the original ones.
- **Source code:** this repository maintains the fork's source. Release packages must have the corresponding source for that release available as required by AGPL-3.0.
- **No warranty:** the software is provided "as is", without warranty of any kind, as described in the AGPL-3.0.

## Disclaimer

Follow AGPL-3.0 and the terms of the services you use, and ensure you have rights to access, save, and use music, lyrics, and other content. This software grants no rights to third-party content and does not guarantee service availability. It is provided without warranty under its license. See the [User Agreement](https://sakura-player.pyabunny.com/en/agreement.html) and [Privacy Policy](https://sakura-player.pyabunny.com/en/privacy.html).
