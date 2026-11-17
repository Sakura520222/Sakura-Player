# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Sakura Player — desktop music player on **Electron + Vue 3 + TypeScript**, with Rust native modules (NAPI-RS) for audio decoding, system media integration, and Windows taskbar lyric. Unofficial fork of SPlayer-Next (successor to SPlayer), maintained by Sakura520222.

## Commands

```bash
pnpm install              # Install deps
pnpm dev                  # Build native (debug) + start Electron dev
pnpm build                # Full build (rimraf → native → typecheck → electron-vite)
pnpm build:{win,mac,linux}# Platform packages
pnpm typecheck            # tsc + vue-tsc (node + web targets)
pnpm lint / format        # ESLint / Prettier
pnpm build:native         # Rust only; add `--dev` for debug
```

`SKIP_NATIVE_BUILD=true` skips Rust during dev.

`audio-engine` static-links FFmpeg via the `ffmpeg_audio` crate (vendor zip + cc-built at compile time). Zero environment dependency — no `FFMPEG_DIR` / `PKG_CONFIG_PATH`, no system FFmpeg required.

## Shell

The development shell is Git Bash on Windows. Write all terminal commands in bash syntax (`&&`, `cd`, etc.) — no PowerShell-only constructs. File paths remain in Windows format (backslashes).

## Architecture

### Process Model

- **Main** (`electron/main/`) — windows, IPC, native modules
- **Preload** (`electron/preload/`) — `contextBridge` exposing `window.api` (player/config/system/library/streaming/lyrics)
- **Renderer** (`src/`) — Vue 3 SPA
- **Lyric windows** (`windows/desktop-lyric`, `dynamic-island`, `taskbar-lyric`) — independent Vue entries sharing `windows/shared/`

### Native Modules (Rust + NAPI-RS)

Four `.node` modules in `native/`, built via `scripts/build-native.ts`, lazy-loaded by `electron/main/utils/nativeLoader.ts`. NAPI-RS auto-generates `index.d.ts`, imported via path aliases `@splayer/audio-engine`, `@splayer/audio-capture`, `@splayer/media-ctrl`, `@splayer/taskbar-lyric`.

- `audio-engine` — `ffmpeg_audio` decode (static FFmpeg) + rodio playback + FFT + cover extraction. URLs wrapped as `Read + Seek` via `ffmpeg_audio::HttpAudioSource` (using `HttpCancelHandle` for cancellation/reset) — TLS handled in Rust (`reqwest` + `rustls`), cross-platform with no system deps. Pushes events (state/position/ended/outputStalled) via ThreadsafeFunction. Has load_token race protection and an `HttpCancelHandle` handle injected into `HttpAudioSource` for instant stop and reset.
- `audio-capture` — System sound / microphone capture for song recognition. Windows via WASAPI Loopback; Linux via PulseAudio (`libpulse-binding`, needs `libpulse-dev` at build time — CI `dev.yml`/`release.yml` install it). Collects 8 kHz mono f32 PCM.
- `media-ctrl` — Cross-platform system media controls (Windows SMTC / Linux MPRIS / macOS MPNowPlaying) + Discord RPC.
- `taskbar-lyric` — Windows taskbar lyric text rendering with RegistryWatcher / UiaWatcher / TrayWatcher.

### Playback Data Flow

```
User action → status store → IPC (player:load/play/pause/seek)
  → main process player.ts → audio-engine
  → Rust events (stateChanged/position/ended/outputStalled)
  → main broadcasts to renderer + syncs to media-ctrl
  → status store updates reactive state
  → playback.ts updates non-reactive time source
```

### State Management

Two-tier position tracking — high-frequency animation vs. low-frequency UI:

- `src/stores/status.ts` — Pinia reactive. `position / duration / state / volume`, pushed ~5Hz from main. Drives progress bar, time display, play button.
- `src/services/playback.ts` — Non-reactive plain vars. `getCurrentTime()` interpolates between pushes; `usePlaybackTime()` reads in RAF loop for 60fps lyrics/spectrum without Vue reactivity.
- `src/stores/media.ts` — Pinia + shallowRef. Current `Track` (lightweight) + `TrackDetail` (lyrics, quality). Only `track + activeLyric` persisted to sessionStorage; never persist `TrackDetail` (large lyric strings cause memory issues).

### Streaming Subsystem

Server protocol clients live in the main process (`electron/main/services/streaming/`): Subsonic / Jellyfin / Emby adapters, safeStorage-backed config, Jellyfin/Emby session management, SQLite synchronization, and the authenticated cover protocol. Subsonic family (Navidrome / OpenSubsonic / Airsonic / Gonic / LMS) shares one adapter; types differ only as UI labels.

- `electron/main/services/streaming/config.ts` — encrypted config and secret-free renderer views.
- `electron/main/services/streaming/connection.ts` — connection tests, connect, and authenticated adapter requests.
- `electron/main/services/streaming/coverProtocol.ts` — `streaming-cover://` proxy registered for the default and `persist:main` sessions.
- `electron/main/services/streaming/adapters/` — Server response → unified `Track / Album / Artist / Playlist`. Trusts server's artist field; no client-side splitting.
- `electron/main/services/streaming/sync.ts` + `snapshot.ts` — cancellable enumeration into temporary SQLite staging, then atomically publish all four indexes; failed or interrupted sync keeps the previous snapshot
- `electron/main/services/streaming/playback.ts` + `playbackSession.ts` — native event driven playback sessions, unique PlaySessionId per play, Jellyfin/Emby start/progress/stop and Subsonic now-playing/scrobble; download and preload never report playback
- Favorites — server responses are authoritative; SQLite and renderer consume per-track updates, with sync-time overrides preventing late pages from overwriting user actions
- `stores/streaming.ts` — Server list, active state, and complete shallowRef arrays; main-process update events trigger SQLite snapshot reloads, with no polling or direct media-server access.
- Credentials — `electron/main/services/streaming/config.ts` encrypts via Electron `safeStorage` to `{userData}/app-data/config/streaming.json`. `accessToken / userId` remain in the bounded main-process session cache and are re-acquired on connect.

Playback resolves remote streaming sources in the main process from `Track.serverId / originalId`; the renderer only passes a `streaming://` identity placeholder or a cached local path. Albums, artists, playlists and navigation retain the originating server ID

Server identity changes advance `mediaRevision`, which is copied to `Track.serverRevision` and
used to isolate playback, song caches, and completed downloads. Renaming a server preserves
its media identity and active playback. Downloads use the protocol's original-file endpoint,
with authentication recovery and permission checks performed in the main process

### Lyric Windows

`windows/desktop-lyric`, `dynamic-island`, `taskbar-lyric` are independent Vue entries. Always use shared composables from `@windows/shared/`:

- `useNowPlayingSync` — playback sync, lyric index, anchor interpolation
- `getNowPlayingCurrentMs()` — non-reactive current time for RAF char highlight
- Line selection: `pickPrimaryIndex` (desktop/taskbar, considers overlap) vs. `pickLatestStartedIndex` (dynamic island, immediate switch)

Don't reimplement these inside individual windows.

### Lyric Alignment and AI Generation

Local alignment runs in the standalone Rust worker `native/lyric-alignment`, managed by
`electron/main/services/lyricAlignment/`. Renderer orchestration lives in
`useLocalLyricAlignment.ts` and `useAiLyricTranslation.ts`; reuse these flows and the shared
lyric types rather than creating separate generation, apply, or save paths.

- Reuse `native/shared/audio_input.rs` and the existing static FFmpeg decoder for acoustic input.
  Reuse AutoMix's ONNX Runtime provisioning; beat analysis is not word alignment, and vocal
  separation must be evaluated on singing samples before becoming a default dependency.
- Keep large acoustic and translation models in short-lived worker processes. Process them
  sequentially; cancellation releases the model lease only after the worker has exited.
- Process the whole song through internal request batches and long-line inference windows.
  Keep memory and transport bounds, but do not turn those bounds or low confidence into arbitrary
  user-facing generation limits. Return valid low-confidence candidates with concise warnings;
  continue rejecting changed source text and invalid timestamps.
- Preserve original text, whitespace, punctuation, stable line IDs, background/duet roles, and
  track identity. Resolve the actual loaded local/cached audio and CUE offset in the main process;
  returned lyric times remain relative to the track in milliseconds.
- A changed primary word sequence or timeline invalidates dependent auxiliary timing and ranges,
  not the translation or romanization text. Preserve auxiliary alignment when the primary words
  and times are unchanged. Apply results through the media store; writing files remains an
  explicit save action.

Auxiliary completeness must describe usable source-word associations, not merely nonempty text,
a span count, or coverage of the line's overall time interval.

- Use `shared/utils/lyricWordRanges.ts` and `src/services/lyric/auxiliaryCoverage.ts` consistently
  for coverage counts, generation plans, application, rendering, and save/reload validation.
  Romanization needs unique, complete source-word coverage; translation may omit source words
  under the translation policy (`hasCompleteAuxiliary(..., true)`). Tests must use the same policy
  as the production caller.
- Preserve explicit `from/to` associations and translation/romanization roles through TTML and
  auxiliary metadata. Never infer the auxiliary track's role from its display position or order.
  Regressions should cover primary generation → auxiliary alignment → partial AI regeneration →
  apply → save → reload, including source index gaps and reordered translation fragments.
- Preserve validated AI rows on failure and retry only unfinished work. Report stable line IDs
  and actionable diagnostics, including expected/actual fragment counts. For romanization
  structure failures, use the ordered slot retry supported by `aiGeneration.ts` and isolate the
  failed line; slot count is the number of supplied words, not syllables or the largest index.
- Keep retries bounded. Existing auxiliary text must remain unchanged during alignment unless
  the user explicitly chooses regeneration for that line. Translation redo retains the reference
  translation's language. Song/revision, language, option changes, close, and cancellation must
  invalidate stale responses without discarding already valid rows during an ordinary retry.

### Type System

- `shared/types/player.ts` — `Track`, `TrackDetail`, `Artist`, `Album`, `AudioQuality`, `PlayerState`, `PlayerStatus`, `PlayerEvent`, `LoadOptions`, `LoadResult`, `IpcResponse`
- `shared/types/lyrics.ts` — `LyricFormat`, `LyricSource (external | embedded | online)`, `LyricData`, `LyricLine`, `LyricWord`, `LyricSpan`
- `shared/types/platform/` — `index.ts` defines `Platform (netease | qqmusic | kugou)`; `netease.ts / qqmusic.ts / kugou.ts` hold platform data contracts shared by main and renderer
- `shared/types/streaming.ts` — `StreamingServerType`, `StreamingServerConfig`, `StreamingPingResult`, `StreamingAuthResult`, etc.

`Track` is for queue storage (no heavy data); `TrackDetail` loads on demand.

### Settings Schema

Declarative — defined in `src/settings/schema.ts`, types in `src/types/settings-schema.ts` (`SettingCategory → SettingSection → SettingItem`). Items bind via `{ store: "settings"|"theme", path: "nested.path" }`; `system.*` paths route through IPC to main config. Tag support on section/item via `SettingTag = { text; type? }` for Beta/experimental badges. i18n keys: `settings.section.{id}` / `settings.{itemKey}.{label,description}`.

### Data Storage

```
{userData}/app-data/        # Unified data directory, separate from Chromium cache data
├── config/
│   ├── settings.json       # Main config (electron/main/store/)
│   ├── streaming.json      # Streaming credentials (safeStorage encrypted)
│   └── lastfm.json         # Last.fm credentials (safeStorage encrypted)
├── database/library.db     # Music library (better-sqlite3, WAL)
├── cache/                  # covers/ (cover:// protocol) + artists/ backgrounds/ songs/
├── logs/                   # App logs + native/
└── plugins/                # scripts/ data/ logs/

# All paths are defined centrally in electron/main/utils/paths.ts
```

Renderer IndexedDB (localforage): `splayer/library`, `splayer/queue`. Local playlists are stored in
SQLite through the main-process playlist service; the old `splayer/playlists` store is migration-only.

### Cover Image

Rust extracts 300x300 JPEG thumbnail to `{userData}/app-data/cache/covers/` during decode; renderer reads via `cover://{filename}` protocol. Original via `getCoverRaw()` for SMTC, never cached. Authenticated streaming covers use the main-process `streaming-cover://` proxy.

### Config Store (Main)

`electron/main/store/` is custom (not electron-store). Reads/writes `{userData}/app-data/config/settings.json` (path via `electron/main/utils/paths.ts`), merges with defaults from `shared/defaults/settings.ts`. Supports dot-path access (`store.get("system.taskbarProgress")`), atomic writes, schema migrations.

### i18n

Renderer uses `vue-i18n` with `src/i18n/locales/{zh-CN,en-US}.json`. Main process has a lightweight translation table (`electron/main/utils/i18n.ts`) for tray/thumbar; locale synced via `system:setLocale` IPC.

### Path Aliases

```
@/                     → src/                   (renderer, tsconfig.web.json)
@shared/               → shared/                (both processes)
@main/                 → electron/main/         (main, tsconfig.node.json)
@windows/              → windows/               (lyric windows)
@splayer/audio-engine  → native/audio-engine    (main)
@splayer/media-ctrl    → native/media-ctrl      (main)
@splayer/taskbar-lyric → native/taskbar-lyric   (main)
```

## Conventions

### Comments — Chinese, with JSDoc

All comments in Chinese. Every newly added or modified method must have a concise, meaningful
JSDoc description of its purpose and parameters, using `@param name - description` and
`@returns` when meaningful. This applies to internal helpers, class methods, adapter methods,
and exported APIs. Anonymous callbacks do not need redundant explanations of obvious logic

Avoid trailing periods in Chinese comments, JSDoc descriptions, and UI copy whenever possible.
Keep the wording concise and natural

```ts
/**
 * <Chinese method description>
 * @param trackId - <Chinese parameter description>
 * @returns <Chinese return description>
 */
```

Forbidden: `// ───` separator lines (including ones with section titles), prose-style multi-paragraph comments, restating-the-obvious comments, numbered enumerations (`1. 2. 3.`) inside comments. Write comments only when the **why** is non-obvious.

### Code Organization

Split logic into files rather than separator comments. Don't extract a helper for one-place callers (3+ uses justify it). No "just in case" defensive code or fallbacks for impossible scenarios. No configurable knobs (timeouts / retries / buffer sizes) unless required — write constants. Don't break errors into per-case enums; `anyhow` or plain `Error` is usually enough.

### UI Consistency and Dialog Lifecycle

- Reuse `SDialog`, `SSelect`, and other shared controls. Keep AI generation and algorithm
  alignment dialogs consistent; do not introduce native selects or independent control styling.
- Keep task dialogs focused on choices, progress, previews, and actions. Avoid manual-like
  paragraphs and implementation details. Model download, verification, removal, size, and license
  information belong in Settings; an unavailable model in a task dialog needs a short status and
  a Settings entry point.
- Do not add native HTML `title` hover hints, custom tooltips, or tray/thumbar tooltip text.
  Preserve visible heading props such as `SDialog.title`; use `aria-label` for icon-only controls
  and inline feedback for actionable errors. Functional menus and the volume panel are controls,
  and drag-time slider feedback may remain; hovering alone must not show a numeric hint.
- Separate dialog visibility from parent mount state. Set `open=false` and cancel work
  immediately, keep the preview mounted through the shared close animation, and unmount on
  `after-close`. Guard rapid reopen against a late close callback.
- Keep asynchronous model status in a stable-height row; do not flash an unavailable-model panel
  while status is loading. Reuse `SDialog`'s closing-height handling rather than clearing content
  before fade-out and moving the centered dialog.
- Verify initial open, asynchronous status completion, close-button/Escape paths, and rapid
  reopen in a rendered UI. Check position and height as well as presence during fade-out;
  a passing component test or build alone does not establish animation behavior.

### Memory Discipline

Memory is a hard requirement. The main process logs memory usage through `app.getAppMetrics()`
60 seconds after launch and then every 10 minutes. When a change touches rendering, caching, or
IPC, verify before and after with these samples.

- **Images by display size** — anything blurred, sampled, or rendered small uses the 300px `cover` thumbnail (player blur background, color extraction, lists). `coverOriginal` only for the visible large cover and poster export. Large `<img>`: add `decoding="async"`; preload with `img.decode()` before fading in.
- **Compositing layers are budgeted** — never put `will-change` in CSS on unbounded element collections; promote dynamically and only near the viewport (lyric engine `lineWillChange` pattern). New full-screen `filter: blur` / `backdrop-filter` layers need justification.
- **Hidden = silent** — high-frequency pushes (`position` / `fftData` / `position-sync`) must not reach hidden windows: `broadcast(channel, data, true)` or an `isVisible()` gate; consumers recover from the next push (≤200ms), no resync needed. Low-frequency state events (`stateChanged` / `ended` / track-change) always go through. RAF loops and canvases must stop when their surface is hidden (engine `freeze()` / `visibilitychange` pattern).
- **In-memory caches must be bounded** — every module-level Map/array cache needs an eviction rule (subsonic `viewAuthCache` evicts per-server). Never retain `TrackDetail`-sized data beyond the current track.

### Units

Frontend time is **milliseconds** everywhere. Rust engine uses seconds internally; `toMs()` in `electron/main/ipc/player.ts` converts.

### Types & Persistence

Never hand-write native module types — import from `@splayer/*`. Use `shallowRef` for `Track` arrays/collections (avoid deep proxy). Vue proxied objects can't be cloned by IDB (`DataCloneError`); use `toRaw` before persisting.

### Auto-imports

In Vue components, `vue / pinia / vue-router / @vueuse/core / vue-i18n` are auto-imported, and UI components in `src/components/` are auto-registered.
Icon components used only in Vue templates are auto-imported. Do not manually import them in
`<script setup>`; import an icon explicitly only when it is referenced by script code.

### Logging (Main Process)

Use scoped loggers from `@main/utils/logger` (`coreLog / playerLog / mediaLog / trayLog / taskbarLog / nativeLog`, etc.). Don't import `electron-log` directly.

### IPC Listeners

In preload's `onEvent`, always `ipcRenderer.removeAllListeners()` before adding a new listener (HMR accumulates otherwise). Renderer composables call the returned `unsubscribe` in `onBeforeUnmount`.

### Prettier

Double quotes, semicolons, 100-char width, trailing commas.

Before committing, run Prettier on every file included in the commit and verify the formatted
working tree before creating the commit. Do not leave formatting-only changes from the current task
outside the commit.

### Shared Types

Put cross-process types (`LocaleCode / SystemConfig / StreamingServerType`, etc.) in `shared/types/`.

### Validation and Commit Scope

- Distinguish deterministic fixtures, real local audio, rendered UI checks, and live AI-provider
  validation in reports. Speech samples do not establish singing accuracy; successful generation
  or model confidence does not establish correct word boundaries.
- Use isolated app data and read-only media inspection for reproduction. Do not overwrite a
  user's songs, embedded lyrics, or sidecars as a debugging shortcut. Keep model downloads, local
  samples, screenshots, and generated reports outside committed source.
- Reuse the existing memory samples for comparable before/after app runs and measure the
  alignment worker separately. One startup sample cannot establish absence of a memory leak.
- Reproduce suspected pre-existing test failures against the actual pre-change commit. A staged
  snapshot containing the current task's changes is not proof that a failure predates the task.
  When a shared helper gains distinct policies, audit production callers and test callers before
  weakening validation to make assertions pass.
- For Rust model tests marked `#[ignore]`, setting `SAKURA_ALIGNMENT_MODEL_DIR` alone does not run
  them. When validating real-model behavior, explicitly run
  `cargo test --locked -p lyric-alignment --test semantic -- --ignored` with a verified model path.
- Stage an explicit, reviewed file list and honor user exclusions, including working notes.
  Check the staged diff, retain unrelated work, and verify the remote commit SHA after an
  authorized push. Keep local commit, push, CI, and release status distinct.
- If Windows rejects a long lint-staged command, run the same checks in bounded batches with
  `pnpm exec lint-staged --max-arg-length 4000`. Do not treat hook startup failure as a passing
  check or disable validation globally to work around command length.

### Commit Messages

Use Conventional Commits with a Chinese summary: `<type>: <summary>`. Keep the title on one line;
do not add a body or bullets unless explicitly requested. Use the type that matches the change,
such as `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `style`, or `chore`.
