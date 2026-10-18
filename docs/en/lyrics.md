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

- **Online TTML:** Enable it in the TTML section. The URL template requires `%p` for platform and `%s` for song ID. AMLL TTML DB lookup supports NetEase and QQ Music associations.
- **Local TTML library:** Enable it and choose a `.ttml` directory. Matching uses embedded song IDs or metadata; one file can associate with multiple NetEase/QQ Music IDs.
- Local matching lets you prefer your own lyric versions. Online TTML selection also depends on source preference and format order.

## Display and fonts

**Settings → Lyrics** offers the physics and AMLL engines, main/adaptive font sizes, independent or main-following translation size, translation and romanization, timed translation highlighting, word romanization, ruby, background-vocal detection, and exclusion rules. Some animation and layout settings appear only for their applicable engine.

**Settings → Appearance → Fonts** configures interface, primary lyric, Chinese/Japanese, Korean, Latin, and external-window fonts. Lyrics also support OpenCC simplified/traditional, regional vocabulary, and selected Japanese character conversions.

The right-hand full-player toolbar provides lyric offset, AI translation, algorithmic alignment, and copying. Immersive mode hides this toolbar. Click a lyric line to seek to its time.

## AI generation and local alignment

Use [AI Features](/en/ai) to add translation or romanization to existing primary lyrics. To map existing text to word timing without a model API key, use [Local Lyric Alignment](/en/lyric-alignment). Both require an explicit save after applying results to write files.

## Copy, share, and save

In **Copy Lyrics**, select lines and choose whether to include translation, romanization, blank lines, title, and artists, then copy text or export a lyric image. **Copy original** reads the current primary lyric content.

**Save complete lyrics** saves the whole song independently of the copying selections and filters:

| Target     | Requirements and overwrite behavior                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Music tags | Writable standalone local audio; unavailable for CUE segments. Keeps the primary format and stores independent translation, romanization, and other auxiliary data |
| LRC        | Matching filename beside standalone local audio, overwriting an existing file; other sources use Save As                                                           |
| TTML       | TTML primary lyrics and an enabled, configured local TTML library; replaces an existing matched library file                                                       |

**Preview changes** compares before and after for each target. An LRC Save As destination is chosen during saving, so the preview has not read that destination. Review each target's success or failure feedback afterwards.

Word-timed primary lyrics use enhanced LRC, while translation is exported line by line in LRC. Preserve timed translation using auxiliary tracks in music tags or an eligible TTML file. Cross-word romanization uses player extension data that other players may not support.

## External lyric windows

| Window         | Controls                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Desktop lyrics | Position, typography, colors, alignment, translation, word display, locking, and click-through |
| Dynamic Island | Compact lyric window and its appearance                                                        |
| Taskbar lyrics | Native lyric rendering inside the Windows taskbar                                              |

Configure styles in **Settings → External Lyrics**, and toggle windows through the toolbar, tray, or other available controls. Linux positioning, always-on-top, and click-through depend on the desktop environment; see [Wayland compatibility](/en/troubleshooting/wayland).
