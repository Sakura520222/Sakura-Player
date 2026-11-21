# Lyrics

## Formats and sources

Supported formats are **TTML, LYS, QRC, KRC, YRC, LRC, ASS, and SRT**. Word highlighting requires word timing in the lyrics. A display switch cannot create precise word timestamps from line-only timing.

| Source             | Content                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| External           | Lyric files beside local audio and lyrics returned by a media server            |
| Embedded           | Primary lyrics and supported auxiliary tracks read from audio tags              |
| Online             | NetEase, QQ Music, and Kugou lyrics with available translation and romanization |
| Plugins            | Lyrics supplied through declared plugin capabilities                            |
| Local TTML library | Matching TTML files in a configured directory                                   |

In **Settings → Lyrics → Lyric content**, configure source preference, platform order, format order, plugin priority, and smart preference. Automatic selection considers existing lyrics and format rankings. Preferred-platform and own-source modes have different fallback behavior; a streaming track's own source means lyrics returned by its server.

## Online and local TTML

- **Online TTML:** Enable it in the TTML section. The URL template requires `%p` for platform and `%s` for song ID. The player can look up NetEase or QQ Music IDs. If that yields no match, it can search AMLL TTML DB by title and artist and use details such as duration to select a candidate.
- **Local TTML library:** Enable it and choose a `.ttml` directory. Matching uses embedded song IDs or metadata; one file can associate with multiple NetEase/QQ Music IDs.
- Local matching lets you prefer your own lyric versions. Online TTML selection also depends on source preference and format order.

## Match lyrics manually

If automatic matching picks the wrong version, click **Match Lyrics** in the full-screen player's lyric toolbar. The dialog searches for the current title and artist. You can edit the search terms and switch between NetEase, QQ Music, and Kugou. Enable online TTML to search AMLL TTML DB on the **TTML** tab.

Select a candidate to preview its lyrics and format. The preview follows the current playback position and places duet lines on different sides, so you can check alternate versions, live recordings, or covers. Click **Use these lyrics** to save the choice for this track. **Restore auto match** clears the saved choice.

## Display and fonts

**Settings → Lyrics** offers the physics and AMLL engines, main/adaptive font sizes, independent or main-following translation size, translation and romanization, timed translation highlighting, word romanization, ruby, background-vocal detection, and exclusion rules. Some animation and layout settings appear only for their applicable engine.

**Settings → Appearance → Fonts** configures interface, primary lyric, Chinese/Japanese, Korean, Latin, and external-window fonts. Lyrics also support OpenCC simplified/traditional, regional vocabulary, and selected Japanese character conversions.

The right-hand full-player toolbar provides lyric offset, AI translation, algorithmic alignment, and copying. Immersive mode hides this toolbar. Click a lyric line to seek to its time.

## AI generation and local alignment

Use [AI Features](/en/ai) to add translation or romanization to existing primary lyrics. Use [Generate primary word timing](/en/lyric-alignment#generate-primary-word-timing) to align line-timed lyrics to local or cached audio. Local alignment can also map existing translations and romanization to the primary word timings.

Primary timing and translation each require a [local model](/en/lyric-alignment#model-management). Romanization alignment works without a model download. After applying results, use **Save and export lyrics** to write a file.

## Copy, share, and save

In **Copy Lyrics**, select lines and choose whether to include translation, romanization, blank lines, title, and artists, then copy text or export a lyric image. **Copy original** reads the current primary lyric content.

**Save and export lyrics** handles the whole song independently of the copying and sharing selections above.

| Target                   | Content and destination                                                                                                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Embed TTML in music tags | Writes complete lyrics to a writable standalone local audio file. Unavailable for CUE segments                                                                                                                                                                              |
| Complete TTML            | Keeps word timing for the lyrics, translation, and romanization. Saves to the enabled and configured local TTML library and can update an existing match. Otherwise, it saves beside standalone local audio using the same basename. For other tracks, choose a destination |
| Compatible format        | Choose LRC, Enhanced LRC (A2), YRC, QRC, or LYS. Saves next to standalone local audio. For other tracks, choose a destination                                                                                                                                               |

Compatible formats write available translation and romanization as line-timed `.tr.lrc` and `.roma.lrc` companion files. LRC preserves line start times, A2 preserves word start times, and YRC and QRC preserve word start and end times. LYS also preserves vocal parts. To keep timed translation and cross-word romanization alignment, choose **Complete TTML** and move the matching `.sakura.json` file with the TTML if one was generated.

**Preview changes** compares existing and new content for each known destination. When you need to choose a path, the preview shows the export and asks for a destination during saving. You can also clear the current translation or romanization in this dialog and save the changes to the selected targets.

## External lyric windows

| Window         | Controls                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Desktop lyrics | Position, typography, colors, alignment, translation, word display, locking, and click-through |
| Dynamic Island | Compact lyric window and its appearance                                                        |
| Taskbar lyrics | Native lyric rendering inside the Windows taskbar                                              |

Configure styles in **Settings → External Lyrics**, and toggle windows through the toolbar, tray, or other available controls. Linux positioning, always-on-top, and click-through depend on the desktop environment; see [Wayland compatibility](/en/troubleshooting/wayland).
