# Data, Caches, and Backups

## Back up and restore settings

Use **Settings → General → Backup & Reset** to export settings JSON or import a backup exported by the player. Restoring replaces main-process and interface settings and restarts the application after confirmation.

A settings backup does not contain audio files, library records, playlists, playback history, artwork/song caches, separately stored service credentials, or local model environments. A settings JSON file does not replace a complete data migration.

## Data locations

| Platform / form   | Default user-data directory                    |
| ----------------- | ---------------------------------------------- |
| Windows installer | `%APPDATA%\Sakura Player\`                     |
| Windows portable  | `SakuraPlayerData\` beside the executable      |
| macOS             | `~/Library/Application Support/Sakura Player/` |
| Linux             | `${XDG_CONFIG_HOME:-~/.config}/Sakura Player/` |

Application-managed data lives under `app-data/`:

```text
app-data/
├── config/        Settings, media sources, Last.fm, AI models
├── database/      library.db: library, playlists, and other local records
├── cache/         Covers, artists, backgrounds, songs (location configurable)
├── logs/          Application and native logs
├── plugins/       Plugin scripts, data, and logs
└── runtimes/      Dedicated lyric translation alignment environment
```

Library indexes and playlists do not contain the audio files themselves. Quit before a complete migration, and back up the actual user-data directory plus the original music folders. Avoid copying only `library.db` while the app is writing. Credentials protected by operating-system secure storage may require sign-in or re-entry on another device.

## Song cache

**Settings → Local & Cache → Song cache** enables online song caching and separately controls caching for media-source tracks. It is off by default. Set a capacity limit after enabling it; `0` means unlimited. Preloading and crossfade may enable these options after confirmation; see [Playback](/en/playback).

Caches speed up playback and are separate from [music downloads](/en/music-downloads). Do not treat them as permanent song storage.

## File and database caches

The same settings page has separate file-cache and database managers for inspecting usage and clearing selected content. Images and song files are different from database caches; check the categories shown before clearing them.

Remove local translation alignment's Python, model, and dependencies through **Uninstall environment** in the [alignment dialog](/en/lyric-alignment). Clearing ordinary image or song caches does not imply uninstalling that environment.

## Reset and complete cleanup

**Reset settings** restores configuration defaults. The current **Clear all data** action clears playlists, related interface storage, and settings. It does not delete the whole user-data directory and should not be treated as a complete erasure of every separate credential, log, database record, or model file.

For a complete reset, quit, back up, confirm the actual data directory, and then clean it manually. Portable and installed versions use different locations. Do not delete original music folders as application data. See [Debugging](/en/troubleshooting/debug) for logs and troubleshooting.
