<div align="center">

<img alt="Sakura Player logo" width="120" height="120" src="public/icons/favicon.png" />

<h2>Sakura Player</h2>

<p>🎵 Cross-platform desktop music player with rich lyric support and wide audio format compatibility.</p>

<p>An unofficial fork of <a href="https://github.com/SPlayer-Dev/SPlayer-Next">SPlayer-Next</a>, maintained by <a href="https://github.com/Sakura520222">Sakura520222</a>.</p>

[![Stars](https://img.shields.io/github/stars/Sakura520222/Sakura-Player?style=flat)](https://github.com/Sakura520222/Sakura-Player/stargazers)
[![Release](https://img.shields.io/github/v/release/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/releases)
[![License](https://img.shields.io/github/license/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/blob/dev/LICENSE)
[![Issues](https://img.shields.io/github/issues/Sakura520222/Sakura-Player)](https://github.com/Sakura520222/Sakura-Player/issues)

**English** | [简体中文](./README.zh-CN.md)

</div>

---

> [!NOTE]
> Sakura Player is a community-maintained fork and is **not** affiliated with the official SPlayer-Next project.
> The original upstream version is developed by [imsyy](https://github.com/imsyy) and the
> [SPlayer-Dev](https://github.com/SPlayer-Dev) organization at <https://github.com/SPlayer-Dev/SPlayer-Next>.
> Sakura Player installs side-by-side with the upstream app and manages its own user data.
> Fork modifications date: **2026-10-13**. Upstream copyright and provenance are retained in [NOTICE](./NOTICE).

## Fork compatibility

- Windows portable builds store data in `SakuraPlayerData/` beside the executable. The upstream `UserData/` directory is left untouched. There is no automatic migration from that shared directory; back it up and identify the data you intend to copy with both applications closed.
- Fresh configurations use port `14568` for HTTP/WebSocket and `14569` for MCP. Both services remain optional and configurable. Saved ports are preserved; use the actual Settings values and choose different ports if imported settings conflict with another player.
- MCP keeps `splayer://now-playing` and `splayer://library/summary` as aliases of the new `sakura-player://` resources. The `splayer` plugin API and native module aliases remain compatible. The `sakura-player` client configuration entry is separate from upstream; configure a distinct port and key when using both servers.
- Windows installation adds file handlers to Open With and does not take over `orpheus://`. Explicitly enabling Orpheus in Settings can change its default handler; automatic startup preserves an existing handler. Disabling or uninstalling only removes a handler still owned by this installation and does not promise to restore a previous user-level choice. macOS declares the existing scheme so external links remain compatible; Launch Services behavior still needs verification with both apps installed.
- Discord RPC is disabled by default and temporarily uses the upstream Application ID, assets, and identity. It makes no independent Sakura Player brand claim. Before an independently branded Discord release, the maintainer must register a real application and supply its assets; no new ID is invented here.

## Features

- 🎵 **Broad format support** — MP3, FLAC, WAV, AAC, OGG, APE, and more, decoded via FFmpeg
- 📝 **Rich lyrics** — LRC / QRC / YRC / TTML, word-by-word highlighting and translations, with desktop, dynamic-island, and taskbar lyric windows
- 🌐 **Streaming servers** — Subsonic / Navidrome / Jellyfin / Emby (multi-server, auto-connect)
- 🖥️ **Cross-platform** — Windows / macOS / Linux
- 🎚️ **Audio spectrum** — real-time FFT visualization
- 🏷️ **Metadata editing** — edit local track tags and cover art
- ⬇️ **Downloads** — built-in download manager
- 🎧 **System media integration** — Windows SMTC / Linux MPRIS / macOS Now Playing + Discord RPC
- ⚡ **High-performance audio engine** — FFmpeg + Rust
- 🎨 **Adaptive theming** — cover-based colors, Light / Dark / Auto
- 📈 **Last.fm scrobbling**

## Development

### Requirements

- **Node.js** >= 22
- **pnpm** >= 10
- **Rust toolchain** (required to build the native modules; see below)

### Native Modules

Core performance features are powered by Rust-based native modules:

| Module          | Description                                                                        |
| --------------- | ---------------------------------------------------------------------------------- |
| `audio-engine`  | High-performance audio decoding (FFmpeg), playback, FFT spectrum, cover extraction |
| `media-ctrl`    | System media controls + Discord Rich Presence                                      |
| `taskbar-lyric` | Native Windows taskbar lyric rendering                                             |

`pnpm dev` and `pnpm build` compile the native modules automatically. To skip them (e.g. when working only on the UI), set `SKIP_NATIVE_BUILD=true`.

### Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Start the dev app (builds native modules in debug, then launches Electron)
pnpm dev
```

### Building

```bash
pnpm build         # Full build: clean → native → typecheck → electron-vite

pnpm build:win     # Package for Windows
pnpm build:mac     # Package for macOS
pnpm build:linux   # Package for Linux (AppImage / deb / rpm / tar.gz / pacman)
```

> By default a build targets the current architecture only. Cross-compilation is not supported.

### Other Scripts

```bash
pnpm typecheck        # tsc + vue-tsc (node + web targets)
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm build:native     # Build the Rust native modules only (add `--dev` for debug)
```

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

This project is intended for personal learning and research only, and must not be used for commercial or unlawful purposes. Some features rely on third-party APIs; users are solely responsible for ensuring their use complies with the relevant laws, regulations, and service agreements. The authors accept no liability for any direct or indirect consequences arising from the use of this project.
