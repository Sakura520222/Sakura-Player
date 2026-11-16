# AutoMix

AutoMix blends the end of one track into the next by analyzing beat timing, downbeats, loudness, and harmonic similarity. It separates each track into drums, bass, vocals, and other accompaniment so each layer can change over at a suitable point.

## Enable AutoMix

1. In **Settings → Player → Playback Transition → Transition mode**, choose **AutoMix** and enable the caches required for next-track preloading when prompted.
2. Open **Configure models** and download the Beat This! beat model, the Demucs stem model, and the analysis runtime. Track analysis runs locally once these components are installed.
3. Play at 1× speed and original pitch and let the queue advance naturally. If the components aren't ready, analysis doesn't finish in time, or the tracks can't be mixed, **Crossfade when mixing fails** uses a regular crossfade when the next track is ready. With that option off, the next track starts normally when the current one ends.

The runtime is available for x64 and ARM64 on Windows, Linux, and macOS. AutoMix requires macOS 14 or later on Apple silicon and macOS 13.4 or later on Intel. See [Playback and Audio Effects](/en/playback#fades-and-crossfade) for other end-of-track transition conditions.

## Feature extraction

The analysis uses the last 40 seconds of the outgoing track and the first 40 seconds of the incoming track, downmixed to mono and resampled to 22,050 Hz.

- **Mel spectrogram:** A short-time Fourier transform uses a 1,024-sample Hann window with a 20 ms hop. The spectrum is mapped to 128 Mel bands from 30 Hz to 11 kHz. The beat model receives the log-compressed energies $\ln(1 + 1000E)$.
- **Chroma:** A 4,096-sample window at 100 ms intervals gives better resolution for closely spaced low notes. Peak frequencies $f$ are refined by log-parabolic interpolation and converted to MIDI pitches, $m = 69 + 12 \log_2(f/440)$. Each pitch is folded modulo 12 and apportioned between adjacent pitch classes. The player L2-normalizes the resulting vector and compares excerpts by cosine similarity.
- **Level:** An RMS measurement every 100 ms helps estimate where the body of the track ends, where sections change, and how closely the two tracks match in loudness.

## Beat and downbeat detection

Beat This! produces separate beat and downbeat scores for each frame. Local peaks within ±3 frames are selected, with adjacent peaks merged by averaging their positions.

The player uses the median inter-beat interval $\tilde T$ to find a stable run of at least eight beats and three seconds. Each interval in the run must be within $\tau = \max(40\,\text{ms}, 0.06\,\tilde T)$ of the median. A least-squares line through beat index $k$ and time $t_k$ estimates the period:

$$
T = \frac{\sum_k (k - \bar k)(t_k - \bar t)}{\sum_k (k - \bar k)^2}
$$

For the outgoing track, the analysis favors the latest stable run. Beat matching requires at least 85% of the beat detections to fall within $\pm\tau$ of the fitted line. A downbeat is snapped first to the nearest beat, then to the fitted grid. It is kept if at least two other downbeats within two bars agree with its bar phase.

## Transition planning

### Tempo alignment

The outgoing track changes speed during the handoff. For $\rho = T_{\text{out}} / T_{\text{in}}$, the player chooses the ratio closest to 1 on a logarithmic scale:

$$
r = \operatorname*{arg\,min}_{r \in \{\rho/2,\ \rho,\ 2\rho\}} |\ln r|
$$

Considering half and double tempo lets a 70 BPM track match a 140 BPM track. Beat matching is used when the chosen speed change is at most 8%. Signalsmith Stretch adjusts the speed while preserving pitch. The incoming track plays at its original speed.

### Candidate scoring

The first accepted downbeat is the entry point for the incoming track. The planner tries overlaps of eight, four, or two bars within a 3.5–18 second range. It considers outgoing downbeats whose overlap would stay within both tracks' stable beat grids.

The score penalizes deviation from the preferred overlap length, a finish far from the end of the track's main section, quiet excerpts, loudness differences, a midpoint far from a section boundary, and harmonic mismatch over long overlaps. Section boundaries are peaks in a novelty curve that compares chroma and level across 1.2 seconds on either side of each point.

For excerpts with chroma similarity of at least 0.7, the preferred overlap is 16 seconds. Otherwise, the planner favors an eight-second overlap and hands off bass and melody together, limiting the time that conflicting harmonies overlap.

### Original-tempo bridge

With a tempo difference above 8% and at most 25% after half- or double-tempo adjustment, two tracks with stable rhythms can transition at their original speeds. The drum and bass layers hand over in about 250 ms on an incoming downbeat, while the vocals and melody fade across the overlap.

- The window starts from a length of 20 beats, rounded down to whole bars, with a minimum of two bars and 3.5 seconds.
- The window is centered around the end of the outgoing track's main section. The rhythmic handoff uses the incoming downbeat closest to 45% of the window within the 30–60% range.

When the tempo difference exceeds 25%, the planner skips AutoMix for that pair.

## Stem separation and vocal checks

HT Demucs separates the transition excerpts, including an extra 1.5 seconds on either side, into drums, bass, vocals, and other accompaniment. The vocal check compares isolated vocal level $v$ to the full mix level $m$ every 100 ms, with $v_{\text{ref}}$ set to the excerpt's 90th-percentile vocal level:

$$
w = \min\!\left(1,\ \left(\frac{v}{v_{\text{ref}}}\right)^2\right) \cdot \min\!\left(1,\ \frac{v}{0.45\,m}\right)
$$

This gives weak backing vocals and bleed a low weight. Vocal segments shorter than 300 ms are treated as noise. The vocal handoff takes 1.5 beats, limited to 400–900 ms. The planner searches in 100 ms steps for a position that minimizes loss of vocal energy and avoids placing active vocals in the middle of the fade. If either track would lose over one second of equivalent lead vocals, the mix is discarded.

## Layered mixing

Each stem has its own handoff interval. At local fade progress $\varphi$, the gains are:

| Stem             | Outgoing track       | Incoming track         |
| ---------------- | -------------------- | ---------------------- |
| Drums            | $\cos(\pi\varphi/2)$ | $\sin^2(\pi\varphi/2)$ |
| Bass             | $1 - \varphi$        | $\varphi$              |
| Vocals and other | $\cos(\pi\varphi/2)$ | $\sin(\pi\varphi/2)$   |

For each stem, the two gains are divided by $\max(1, \sqrt{g_{\text{out}}^2 + g_{\text{in}}^2})$ to cap their combined power. In a typical beat-matched transition, the incoming drums enter quietly two bars early, the outgoing drums yield on a downbeat, and bass follows one bar later. Vocals switch during a gap, and the outgoing melody leaves last.

The incoming drums are split with a second-order 150 Hz Butterworth high-pass filter. Higher frequencies such as hi-hats can enter early. The low-frequency component follows the phase of the outgoing drums so the kick drums hand over on the same downbeat.

To preserve the original mix outside the handoff, the other accompaniment is reconstructed from the original signal $x$ minus the drums, bass, and vocals. With stem signals $s_i$ and gains $g_i$, the mix is:

$$
y = g_{\text{other}}\,x + \sum_{i \in \{\text{drums},\ \text{bass},\ \text{vocals}\}} (g_i - g_{\text{other}})\,s_i
$$

When all gains are equal, this gives the original mix scaled by that gain. The louder track is attenuated to match the quieter one during the handoff, with the loudness ratio limited to 0.5–2. The mixed output uses the same [soft limiter](./crossfade#soft-limiting) as Crossfade.
