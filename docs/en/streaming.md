# Streaming Services

In addition to local music and online sources, Sakura Player can connect to self-hosted streaming servers and browse your private library.

## Supported services

| Type                | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| **Subsonic family** | Navidrome, OpenSubsonic, Airsonic, Gonic, LMS, and compatible servers |
| **Jellyfin**        | Open-source media server                                              |
| **Emby**            | Media server                                                          |

> Subsonic-compatible services share the same protocol and differ only by their UI label.

## Adding a server

1. Open **Settings → Media Sources** and ensure media sources are enabled.
2. Add a server and select Subsonic, Jellyfin, or Emby.
3. Enter its URL, username, and password.
4. Test the connection if needed, then save. The first server becomes active automatically; use **Connect** to switch to another server. Browse tracks, albums, artists, and playlists under **Media Sources** in the sidebar.

You can configure multiple servers and switch the active one. Leave the password blank when editing to reuse its saved value.

::: tip Credential security
The main process encrypts server passwords using operating-system `safeStorage`. It refuses to save a nonempty password without secure storage or with the Linux `basic_text` backend; there is no plaintext Base64 fallback. `accessToken` and `userId` remain in the main-process session cache, are reacquired on connection, and are not exposed to the interface as persisted configuration.
:::

## Sync, favorites, and server identity

Track, album, artist, and playlist indexes synchronize into local SQLite storage. A completed sync publishes all indexes together. Failure or interruption keeps the previous complete snapshot; retry after reconnecting without publishing partial results as a full library.

Favorite updates follow the server response and then update local lists. Renaming a server preserves its media identity. Changing its address, type, username, or password advances that identity, keeping old caches and downloads separate from the new account's media.

## Playback, lyrics, and downloads

The main process resolves playback URLs and authentication; the interface uses a credential-free media identity. Covers also pass through a main-process proxy. Server lyrics or other sources are selected according to [lyric preferences](/en/lyrics).

Actual playback drives Jellyfin/Emby start, progress, and stop sessions, and Subsonic now-playing/scrobble reporting. Downloads and preloading are not reported as playback. Downloads request the original file and follow the server's download permissions; see [Music Downloads](/en/music-downloads).

## Troubleshooting

- **Connection failed:** Verify the protocol (`http://` or `https://`), port, username, and password.
- **Track will not play:** Check that the server can transcode or return a direct URL and that it is reachable from this device.
- **Old content remains after a failed sync:** This preserves the last complete snapshot. Resolve the error and synchronize again.
- **Cannot save a password:** Enable the system keyring or repair secure storage. Re-enter credentials if decryption fails.
