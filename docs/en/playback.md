# Playback and Audio Effects

## Queue and quality

The player supports list repeat, repeat-one, and shuffle, with queue viewing and reordering. In **Settings → Player → Playback control**, choose whether playing a search result plays only that track or queues the search results.

**Settings → Player → Audio source** provides default quality and trial-play options. Available online quality depends on the source, account permissions, and track resources. Selecting a higher quality does not convert a lower-quality file into lossless audio.

## Playback toolbar menu

| Entry                    | Purpose                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Audio output information | Inspect the actual device, exclusive state, source/output sample rates, bit depth, resampling, and DSP state |
| Equalizer                | Adjust 10 frequency bands and preamp gain, or choose a preset                                                |
| Playback Speed           | Set 0.5–2× speed and -12 to 12 semitones; Preserve pitch keeps the original pitch while changing speed       |
| A-B Loop                 | Set A and B, with B later than A, then enable segment looping                                                |
| Sleep Timer              | Set a 1–180 minute timer, optionally waiting for the current track to finish                                 |

These tools are available from the More menu in both the regular toolbar and full-screen player. The timer stops playback; it does not schedule an operating-system shutdown.

## Fades and crossfade

**Settings → Player** provides separate controls for:

- **Fades:** Smooth volume changes on playback start/stop, with a 100–600 millisecond duration.
- **Preload next track:** Cache and decode the next song ahead of time, potentially increasing network and disk usage.
- **Crossfade:** Hand over at the end of a track, with conservative, standard, or eager transition preferences.

If song caching or streaming caching is disabled, enabling preload or crossfade asks for confirmation and enables the required caches. Crossfade also enables preloading; disabling preloading changes the transition mode to None.

A transition requires the next track to be ready and depends on playback mode, source, and cache state. Not every track switch can crossfade. See [Data Management](/en/data-management) for cache limits and cleanup.

## Output devices

Choose devices in **Settings → Player → Output device**, with options such as pausing on device changes and volume synchronization. Windows offers WASAPI exclusive output. Check **Audio output information** to see whether exclusive output is actually active and whether resampling is occurring.

Normalization, equalization, speed, and pitch changes participate in audio processing. Actual output information is more useful than preference switches alone when checking the current signal path.

## Lyrics, spectrum, and shortcuts

- Click the playback-bar cover to expand the full-screen player and switch lyrics, queue, and immersive display.
- Enable the spectrum in **Settings → Player → Music spectrum**.
- Configure in-app and global scopes separately in **Settings → Hotkey Settings**. Duplicate or system-occupied combinations produce conflict messages.
- See [Lyrics](/en/lyrics) for desktop lyrics, Dynamic Island, and Windows taskbar lyrics.

Linux shortcuts and floating windows can depend on the desktop environment. See [Wayland compatibility](/en/troubleshooting/wayland).
