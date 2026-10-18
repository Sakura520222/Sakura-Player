# Library, Playlists, and Statistics

## Add and scan local music

Open **Library** in the sidebar and add folders to scan. Once tracks are present, use **More → Folder management** to add further directories. Adding a folder starts a scan.

- The refresh button performs an incremental scan; **More → Full scan** scans the configured folders again.
- Progress appears during scanning. Afterwards, search the list and sort using its column headers.
- Artist, album, and folder pages browse the same library. Music files do not need to be copied into the application's data directory.
- CUE tracks play a time range of their referenced audio file. Keep the CUE file and referenced audio paths valid.

Folders are managed on the library page; there is no separate Local Music category in Settings. Entering a library with configured directories starts a scan. Scan again after files change to refresh the index.

## Tags and artwork

Local track menus provide metadata editing for titles, artists, albums, covers, and other supported fields. This writes to the audio file. Ensure the file is writable and keep originals before making batch changes.

CUE tracks share an audio file and cannot use the ordinary standalone-track workflow to write separate file tags for every segment. Editing tags and changing display preferences are separate operations.

Lyrics have their own complete-save and diff-preview workflow; see [Lyrics](/en/lyrics).

## Liked songs

**Liked Songs** has local and online tabs. Local likes belong to the local library; the online tab uses the signed-in NetEase account's liked playlist. Media-server favorites are managed within each [media source](/en/streaming).

**More → Copy to Clipboard** copies the displayed tracks as one `Title - Artist` per line, following the current sort direction and search filter. An empty search result does not copy hidden tracks.

Use **Batch management** in the More menu to select tracks and use the actions available on that page.

## Local playlists and online collections

Create local playlists, edit their name and description, add tracks through track menus, and remove tracks or delete a playlist. Local playlists live in the player's database. Deleting a playlist and deleting audio files from disk are separate actions.

Online playlist, album, and artist collections, plus NetEase daily recommendations, Personal FM, and cloud-library entries, depend on sign-in state and the platform's responses. See [Integrations](/en/integrations) for account entry points. Independent source plugins expose their own results through [plugin search](/en/plugins/source#musicsearch).

## History and statistics

| Page         | Contents                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| Play History | Tracks recorded by the player, available to play again                                                          |
| Stats        | Library overview, listening heatmap, hourly activity, quality distribution, and top tracks, albums, and artists |

Stats uses local records. The listening heatmap covers the last 90 days, and each top list contains 10 entries. It does not automatically import a third-party account's complete history and is separate from [Last.fm or NetEase scrobbling](/en/integrations).

## Backup scope

**Back up settings** exports configuration only. It does not back up the library, playlists, playback history, or original audio. See [Data Management](/en/data-management) before migrating, and preserve application data and music files separately.
