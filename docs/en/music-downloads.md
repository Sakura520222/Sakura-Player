# Music Downloads

This page covers saving songs locally. For application installers, see [Download Sakura Player](/en/download). For temporary playback caches, see [Data Management](/en/data-management).

## Enable and use downloads

1. Open **Settings → Downloads**, enable downloading, and choose a directory.
2. Use a supported track menu or the full-player download entry. Choose a quality or follow the default.
3. For batch downloads, select tracks and add them to the download queue.
4. Open **Downloads** in the sidebar to inspect Queue, Errors, and Completed tasks.

Local songs do not need downloading again. Platforms, plugins, and media servers expose different download actions. Resources and permissions depend on the service.

## Options

| Option                     | Behavior                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Quality                    | Defaults to lossless and can be overridden per task; the source determines the actual file              |
| Reuse playback URL         | Choose whether to download from the playback address; separate download URLs still follow service rules |
| File naming                | Title, Artist - Title, or Title - Artist                                                                |
| Folder grouping            | None, artist, or artist/album                                                                           |
| Existing files             | Rename by default, or choose overwrite or skip                                                          |
| Embedded and extra content | Optional artwork, metadata, lyrics, matching LRC, and complete TTML                                     |
| LRC format                 | Line LRC or enhanced LRC; enhanced LRC is the default                                                   |

Media-source downloads use the server's original-file download endpoint and may require additional download permission. Downloading is not reported as playback; downloads and preloading do not produce server scrobbles.

## Manage tasks

- **Queue:** Queued and downloading tasks, with cancellation.
- **Errors:** Failed, cancelled, or interrupted tasks, with retry where available.
- **Completed:** Play downloaded songs or open their containing folder.
- **Failed to write tags; file saved:** The audio file was downloaded, but artwork, lyric, or metadata processing did not fully succeed.

**Remove** and **Clear finished** remove task records. Clear finished also removes finished error records and keeps downloaded files. **Delete file** is a separate action with confirmation that permanently removes the file from disk.

The player detects matching queued track/quality tasks and existing downloaded files to prevent duplicates. Changing a media server's address or account separates subsequent downloads under the new media identity.

## Troubleshooting

| Symptom                           | Check                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| No download action                | Whether downloading is enabled and the source exposes that action                                                     |
| Resolution or download failure    | Network, source availability, account permissions, and directory write access; inspect the task error before retrying |
| Quality differs from selection    | Whether the source has that quality and whether playback URL reuse is enabled                                         |
| Files remain after clearing tasks | Clearing records keeps files; deleting files is separate                                                              |
| Missing extra lyric files         | Whether LRC/TTML saving is enabled and the lyric source supplies that content                                         |
