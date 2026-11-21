# Playback and Audio Effects

## Queue and quality

The player supports list repeat, repeat-one, and shuffle, with queue viewing and reordering. In **Settings → Player → Playback control**, choose whether playing a search result plays only that track or queues the search results.

**Settings → Player → Audio source** provides default quality and trial-play options. Available online quality depends on the source, account permissions, and track resources. Selecting a higher quality does not convert a lower-quality file into lossless audio.

## Song highlights

**Settings → Player → Playback control → Find Song Highlights** is enabled by default. Once a track finishes loading, the player queries NetEase's chorus annotations or Kugou's highlight annotations. It reuses existing platform sessions and the selected Kugou standard/concept variant without requiring a separate service setup.

When annotations are available, gold bands show the highlight ranges on the progress bar. Click the **flame button** to jump to a highlight's start in the regular, floating, or full-screen player. Seeking while paused keeps playback paused. For multiple highlights, the button selects the next upcoming range, or returns to the first when none remain. The bands display ranges; adjust playback position by dragging the progress bar as usual.

Turn off **Highlight marks on progress bar** to hide the bands and keep highlight lookup and the flame button available.

- **NetEase and Kugou tracks:** Query the original platform's song ID or Hash first. If no valid annotation is available or the request fails, try matching a version on the other platform.
- **Local, QQ Music, and streaming tracks:** Search by title and artist, then use album and duration to select a matching version. No highlight range is shown when a reliable match cannot be found.
- **Plugin-source tracks:** Do not participate in the built-in platforms' highlight queries.
- **Retries and caching:** Valid annotations are cached in memory to reduce repeated requests and are discarded when the player exits. Click the flame button again to retry an empty or failed lookup.

Highlight queries require a network connection and depend on platform annotation coverage. For repeated failures, check your connection and [platform login status](/en/integrations#accounts-and-online-pages).

Queries send the song ID / Hash or title-and-artist search terms to the corresponding platform. They do not read or upload audio files. Turning off **Find Song Highlights** stops new highlight queries and hides the bands and flame button.

## Playback toolbar menu

| Entry                    | Purpose                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Audio quality and output | [Inspect source, decoder, and output formats or analyze a local file's spectrum](#audio-quality-diagnostics) |
| Equalizer                | Adjust 10 frequency bands and preamp gain, or choose a preset                                                |
| Playback Speed           | Set 0.5–2× speed and -12 to 12 semitones; Preserve pitch keeps the original pitch while changing speed       |
| A-B Loop                 | Set A and B, with B later than A, then enable segment looping                                                |
| Sleep Timer              | Set a 1–180 minute timer, optionally waiting for the current track to finish                                 |

These tools are available from the More menu in both the regular toolbar and full-screen player. The timer stops playback; it does not schedule an operating-system shutdown.

## Fades and crossfade

**Settings → Player** provides separate controls for:

- **Fades:** Smooth volume changes on playback start/stop, with a 100–600 millisecond duration.
- **Preload next track:** Cache and decode the next song ahead of time, potentially increasing network and disk usage.
- **Playback Transition → Transition mode:** Choose No transition, [Crossfade](/en/crossfade), or [AutoMix](/en/automix). **Mix handoff preference** offers Conservative, Standard, and Eager settings.

Enabling preload or either transition mode prompts you to enable any required song and streaming caches. Choosing a transition mode enables preloading. Disabling preloading sets the mode to **No transition**.

A transition requires the next track to be ready. End-of-track transitions are skipped during repeat-one, Personal FM, A-B looping, or when the sleep timer will stop after the current track. See [Data Management](/en/data-management) for cache limits and cleanup.

## Output devices

Choose a device in **Settings → Player → Output Device** and configure options such as pausing on device changes and volume synchronization. On Windows, change **Audio Output Mode** here or click the quality badge on the main playback bar or full-screen controls while a track is loaded.

| Windows output mode     | Playback behavior                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared Mode             | The default. Uses the system mixer so other apps can use the device at the same time                                                                                                                    |
| WASAPI Exclusive Mode   | Tries to reserve the device exclusively. Player volume and effects remain available                                                                                                                     |
| WASAPI exclusive direct | Requires local mono or stereo lossless integer PCM and a device that accepts the source sample rate, channel count, and bit depth. Direct output bypasses player volume, EQ, and loudness normalization |

Lower the device volume before switching to exclusive direct. Other apps may lose access to the device while it is held exclusively. If the source or device cannot support direct output, the player tries a conventional playback path. Check **Audio quality and output** for the actual mode and reason.

## Audio quality diagnostics

While playing, open **More → Audio quality and output** on the playback bar. The panel reports source-file, decoder PCM, and output-stream parameters separately, including resampling, valid bit depth, output device, and effect status. For local audio, it also shows available ReplayGain and R128 tags and lets you jump to chapters.

Exclusive direct reports whether PCM submission is pending, verified through WASAPI, interrupted, or unavailable. Verification covers the PCM frames the player checks sample by sample and submits to WASAPI.

Select **Analyze spectrum** to sample a local audio file. A high-frequency cutoff can indicate lossy transcoding or low-pass filtering. Interpret it alongside the codec, valid bit depth, and file provenance.

## Lyrics, spectrum, and shortcuts

- Click the playback-bar cover to expand the full-screen player and switch lyrics, queue, and immersive display. Under **Settings → Appearance → Player → Player Layout**, choose Classic, Fullscreen Cover, Fullscreen Lyrics, or AM Style.
- Enable the spectrum in **Settings → Player → Music spectrum**.
- Configure in-app and global scopes separately in **Settings → Hotkey Settings**. Duplicate or system-occupied combinations produce conflict messages.
- See [Lyrics](/en/lyrics) for desktop lyrics, Dynamic Island, and Windows taskbar lyrics.

Linux shortcuts and floating windows can depend on the desktop environment. See [Wayland compatibility](/en/troubleshooting/wayland).

## Sakura Liquid theme

In **Settings → Appearance → Theme → Application theme**, select **Sakura Liquid**. The floating playback bar and full-screen controls can refract the track list and lyrics as they scroll underneath. Classic and Sakura Liquid save their appearance and layout settings independently, so switching themes restores the selected profile.

Open **Glass and motion** to adjust refraction, glass transparency, rendering quality, and theme motion. Auto adapts to device capabilities, Balanced limits refraction to key surfaces, and Low Power uses opaque surfaces. When refraction is unavailable, the theme uses frosted or opaque surfaces depending on rendering support. System high contrast uses opaque surfaces. This section also shows the active material. Theme motion follows system and app reduced-motion preferences.

Under **Appearance → Player → Player Layout**, choose the Sakura Liquid full-screen layout or keep using any of the other layouts.

## Animated covers

Choose a source in **Settings → Appearance → Player → Animated Cover**. The feature is off by default. The full-screen player shows static artwork when no video is available.

| Option    | Source and requirements                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NCM Only  | Streams available artwork for NetEase tracks when signed in                                                                                                                      |
| AM Only   | Matches track metadata to an Apple Music animated album cover and caches the video locally                                                                                       |
| Prefer AM | Uses the cached Apple Music cover first. With no cached cover, an available NetEase video plays for the current track while the Apple Music cover is prepared for later playback |

See [File and database caches](/en/data-management#file-and-database-caches) for Apple Music cover cache limits and cleanup.
