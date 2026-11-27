# User Guide

This page covers the basics of Sakura Player. See [Download](/en/download) for installation packages.

| Task                                                     | Guide                                                   |
| -------------------------------------------------------- | ------------------------------------------------------- |
| Scan folders, manage likes/playlists, inspect statistics | [Library and Statistics](/en/library)                   |
| Find song highlights and jump to them                    | [Song highlights](/en/playback#song-highlights)         |
| Equalizer, speed, A-B loop, timer, and crossfade         | [Playback and Effects](/en/playback)                    |
| Switch themes, adjust glass and motion                   | [Sakura Liquid theme](/en/playback#sakura-liquid-theme) |
| Switch WASAPI modes and check the active stream          | [Output devices](/en/playback#output-devices)           |
| Match lyrics manually, adjust fonts, copy, and save      | [Lyrics](/en/lyrics)                                    |
| Download songs, retry, and manage files                  | [Music Downloads](/en/music-downloads)                  |
| Accounts, recognition, Last.fm, and Discord              | [Integrations](/en/integrations)                        |
| Caches, settings backup, and migration                   | [Data Management](/en/data-management)                  |

## Playing music

- **Search and play:** Enter a song, artist, or album in the top search box, then play it or add it to the queue.
- **Queue:** Use sequential, shuffle, and repeat-one modes, and drag tracks to reorder them.
- **Quality and effects:** Choose quality, fades, and normalization in Player settings. The toolbar's More menu opens the equalizer, speed/pitch, A-B loop, and sleep timer.

Click the playback-bar cover to open the full-screen player and view [playback layout and animated cover options](/en/playback#animated-covers). Choose [Crossfade](/en/crossfade) or [AutoMix](/en/automix) to blend into the next track.

## Local music

1. Open **Library** in the sidebar and add folders to scan. Manage them later through **More → Folder management**.
2. After scanning, browse the library by track, album, or artist.
3. Local track tags and cover art can be edited in the metadata editor.

The library also scans external multi-file CUE sheets and embedded CUE sheets. See [Add and scan local music](/en/library#add-and-scan-local-music).

## Streaming

Connect self-hosted Subsonic, Navidrome, Jellyfin, or Emby servers. See [Streaming Services](/en/streaming).

## Lyrics

Sakura Player supports TTML, LYS, QRC, KRC, YRC, LRC, ASS, and SRT, including word highlighting, translation, and romanization. Selection considers source preference, platform/format order, smart preference, and existing lyrics. See [Lyrics](/en/lyrics).

[Local lyric alignment](/en/lyric-alignment) can generate primary word timing from audio and map existing translations and romanization to a word-timed lyric. Prepare the primary lyric or translation model in **Settings → Lyrics → Lyric alignment models**. Romanization alignment works without a model download. Use [AI Features](/en/ai) to generate missing translation or romanization.

### Online TTML lyrics

[AMLL TTML DB](https://github.com/amll-dev/amll-ttml-db) is a community-maintained database of high-quality word-timed lyrics, often including translations and romanization.

- Enable **Settings → Lyrics → Online TTML lyrics** (Beta).
- Configure the AMLL TTML DB URL template. It must contain `%p` for platform and `%s` for song ID.
- When a match is found, its timed words, translation, and romanization are used.

### Local TTML library

If you maintain your own TTML files, select a local directory as a lyrics library:

- Enable **Settings → Lyrics → Local TTML lyrics library** (Beta).
- Choose a folder containing `.ttml` files. Matching uses song IDs or metadata such as title and artist; one file can associate with multiple platform song IDs.
- A local match takes precedence over online lyrics.

### Lyrics windows

- **Desktop lyrics:** A configurable floating window with positioning, typography, colors, alignment, translations, word timing, locking, and click-through.
- **Dynamic Island:** A compact lyric strip centered at the top of the screen.
- **Taskbar lyrics (Windows):** Displays the current line in the Windows taskbar.

Toggle these windows from the player or tray menu and configure their styles independently.

## AI lyric translation and listening companion

1. Add, test, and activate a model in **Settings → AI Integration → AI Model Configuration**.
2. Click the language icon beside the full-player lyrics to open **AI Lyric Translation**.
3. Select translation, romanization, word romanization, or word translation. Use **Fill missing** to preserve existing content or **Regenerate all** to replace selected content.
4. Review the streamed preview and **Apply selected content** when generation completes. Cancelled or failed tasks can be resumed in the current dialog.
5. To keep the results, preview changes and save under **Copy Lyrics → Save and export lyrics**.

To chat about music while listening, enable the desktop character, proactive comments, and full-player danmaku under **Settings → AI Integration → Listening Companion**. See [AI Features](/en/ai) for configuration fields, target languages, resume conditions, companion options, and save requirements. Applying lyric results does not automatically write audio tags or lyric files.

## System integration

- **System media controls:** Windows SMTC, Linux MPRIS, and macOS Now Playing provide lock-screen, notification, and media-key control.
- **Discord status:** Optionally show the current track in Discord.
- **Global shortcuts:** Bind global playback shortcuts in Settings.

## Plugins

The plugin system extends music sources and playback control. See [Using Plugins](/en/plugins-usage) and [Plugin Development](/en/plugins/).

## External control

Optional HTTP and WebSocket APIs and a separate local MCP service let other programs or AI clients inspect and control playback. See the [HTTP API](/en/api), [WebSocket API](/en/socket), and [MCP interface](/en/mcp).
