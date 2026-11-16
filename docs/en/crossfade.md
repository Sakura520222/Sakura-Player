# Crossfade

Crossfade fades out the current track and fades in the next one before the current track ends. It uses signal level to pick the handoff point and can work without a beat grid.

In **Settings → Player → Playback Transition → Transition mode**, choose **Crossfade** and enable the caches required for next-track preloading when prompted. **Mix handoff preference** controls how early the player looks for a handoff and how long the tracks can overlap. See [Playback and Audio Effects](/en/playback#fades-and-crossfade) for when an end-of-track transition can run.

## Choosing a start point

With fade duration $F$ and $R$ seconds left in the current track, the latest start is $R - F$. The player searches a window of length $W$ before that point:

$$
t_{\text{earliest}} = R - F - W, \qquad t_{\text{latest}} = R - F
$$

It measures the root mean square (RMS) level of each 50 ms frame:

$$
\text{RMS} = \sqrt{\frac{1}{N} \sum_{n=0}^{N-1} x[n]^2}
$$

The fade starts after $k$ consecutive frames below the threshold $\theta$. If the search finds no quiet passage, it starts at the latest possible point.

| Preference   | Maximum fade $F$ | Search window $W$ | RMS threshold $\theta$ | Consecutive frames $k$ |
| ------------ | ---------------- | ----------------- | ---------------------- | ---------------------- |
| Conservative | 3.0 s            | 1 s               | 0.04 (≈ −28 dBFS)      | 4 (200 ms)             |
| Standard     | 3.6 s            | 2 s               | 0.04 (≈ −28 dBFS)      | 4 (200 ms)             |
| Eager        | 5.0 s            | 3 s               | 0.06 (≈ −24 dBFS)      | 3 (150 ms)             |

The fade is also limited by the time left in the outgoing track and half the playable duration of the incoming track $D_{\text{next}}$:

$$
F = \min\left(F_{\max},\ R,\ \frac{D_{\text{next}}}{2}\right)
$$

## Skipping leading silence

The incoming track mixes in at the first sample above −56 dBFS. The player scans at eight times real speed before the fade and can skip up to eight seconds of leading silence.

## Equal-power curves

At fade progress $p \in [0, 1]$, the gains are:

$$
g_{\text{out}}(p) = \cos\frac{\pi p}{2}, \qquad g_{\text{in}}(p) = \sin\frac{\pi p}{2}
$$

The two tracks can usually be treated as uncorrelated signals, whose powers add:

$$
P = g_{\text{out}}^2 P_{\text{out}} + g_{\text{in}}^2 P_{\text{in}}
$$

Since $\cos^2 + \sin^2 = 1$, tracks of similar loudness keep roughly constant power through the overlap. A linear fade would give two 0.5 gains at the midpoint, reducing combined power by 3 dB. For highly correlated signals, such as two versions of the same track, amplitudes add and a linear fade can hold the level constant.

The fade advances in source audio time. Changing playback speed changes how long the transition takes in real time while preserving the portion of audio it covers.

## Soft limiting

Mixing two signals can create peaks above full scale. A soft-knee limiter processes the combined output:

$$
y =
\begin{cases}
x, & |x| \le 0.95 \\
\operatorname{sign}(x)\left(0.95 + 0.05\left(1 - e^{-(|x| - 0.95)/0.05}\right)\right), & |x| > 0.95
\end{cases}
$$

Samples through 0.95 pass through unchanged. Above that threshold, the magnitude approaches 1.0 exponentially. The value and slope are continuous at the knee, which avoids the abrupt waveform changes of hard clipping.

## Limits

The drums in two overlapping tracks can land off beat, particularly when the tempos differ. [AutoMix](./automix) can align compatible beats and hand off drum, bass, vocal, and accompaniment layers separately.
