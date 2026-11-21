# Algorithmic lyric alignment

Open **Algorithmic lyric alignment** beside the lyrics in the full-screen player. It can generate word timing for existing line-timed primary lyrics from audio, then map existing translations and romanization to that timeline. Alignment preserves the text and runs in the bundled **Rust worker**. To generate new translation or romanization text, use [AI Lyric Translation](/en/ai).

## Generate primary word timing

1. Play a local audio file or a fully cached source and load primary lyrics with line timings.
2. Prepare the **Primary lyric model** in **Settings → Lyrics → Lyric alignment models**. If it is missing, the dialog offers **Open settings**.
3. In **Algorithmic lyric alignment**, select **Generate primary word timing**, choose Mandarin Chinese, Japanese, or English, and click **Start alignment**.
4. Listen to the lines marked **Review**, select the candidates you want, and click **Apply selected**. To write the result to a file, choose [Complete TTML](/en/lyrics#copy-share-and-save) under **Copy Lyrics → Save and export lyrics**.

You can select existing translation and romanization in the same run. The worker processes primary timing first and aligns the selected auxiliary text to the resulting words. Translation also requires the translation model. The two models run in sequence. Changes to primary words or timings invalidate dependent auxiliary alignments while preserving their text.

Timing is in beta. The worker returns low-confidence candidates with a warning, so check word boundaries against the audio, especially for sustained notes, heavy accompaniment, and overlapping voices. It can recalculate existing word timings and processes long lines and full songs in internal batches. Background vocals are outside the scope of primary timing generation.

The acoustic worker uses a pinned MMS_FA UINT8 ONNX model and CTC alignment. It keeps the original wording, spacing, and punctuation. Mandarin aligns by character, English by word, and Japanese uses dictionary readings and groups kana where appropriate. CUE offsets locate audio in the source file, while lyric times stay relative to the track.

## Using alignment

1. Load primary lyrics with word timings and an existing translation or romanization.
2. Open **Algorithmic lyric alignment** and select either auxiliary track or both.
3. For translation, prepare the **Translation model** in **Settings → Lyrics → Lyric alignment models**. Romanization works without a model download.
4. Click **Start alignment**, review the candidates, and select the lines to apply.
5. Click **Apply selected** to update the display. Use the lyric save controls to write the result to a file.

For auxiliary-only alignment, complete alignments are preserved by default. Enable **Realign existing translation and romanization** to recalculate selected tracks. The preview reports requested, matched, and previously aligned counts separately.

Auxiliary-only alignment needs existing auxiliary text and at least two independent timing anchors in the primary line. Review the resulting candidates before applying them.

## Romanization

Lindera/IPADIC provides Japanese morphology and readings. Native WanaKana conversion, global edit distance, and unique reading anchors match existing romanization. Compatibility data preserves the original IPADIC reading order and tie priorities, including ruby hints, particles, long vowels, gemination, spelling variants, and readings spanning multiple timed words.

Chinese pinyin uses dictionary reading candidates and an exact, unique complete match. Tone marks, casing, punctuation, whitespace, and the distinction between `u` and `ü` are retained. Missing words, ambiguous boundaries, or insufficient matches keep the original line.

## Translation

Candle runs the pinned multilingual BERT on the local CPU and extracts layer-eight token vectors, matching the original SimAlign configuration. Rust implements cosine similarity, IterMax, subword and whole-word candidates, semantic heads, phrase expansion, and dictionary-form alternatives in the original priority order.

Chinese segmentation uses ICU dictionary data with the ICU4C minimum-cost path rather than greedy segmentation. Word pairs map to original lyric ranges. Cross-language reordering uses the existing auxiliary timing workflow; translation length never creates timing anchors.

Translation failures preserve completed romanization and existing translations. Details remain available in the dialog.

## Model management

### Download and storage

Both models are managed in **Settings → Lyrics → Lyric alignment models**. After setup, alignment runs offline.

| Model               | Download and storage                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary lyric model | [MMS_FA UINT8](https://huggingface.co/xycld/lyric-align-mms-fa), approximately 302 MiB, under `{userData}/app-data/runtimes/lyric-acoustic/model/`. The weights are subject to Meta's CC BY-NC 4.0 non-commercial license and are downloaded separately from the player |
| Translation model   | `google-bert/bert-base-multilingual-cased` at revision `3f076fdb1ab68d5b2880cb87a0886f315b8146f8`, approximately 714 MB of weights, under `{userData}/app-data/runtimes/lyric-alignment/model/`                                                                         |

The primary lyric model shares the ONNX Runtime used by AutoMix. If that runtime is missing, model setup installs it without downloading AutoMix beat or stem-separation models.

Downloads respect the player proxy configuration. Setup verifies file sizes and SHA-256 and writes the ready marker after native inference succeeds.

Opening the dialog or starting alignment never starts a download automatically. Downloads can be cancelled and retried. Closing the dialog or main window keeps maintenance running; reopening restores progress. Explicitly quitting cancels maintenance and waits for cleanup.

**Download** and **Verify** check local files first and only fetch missing or damaged files. Retry after failed verification to reuse valid files.

### Removing the model

**Remove** deletes the selected model. Removing the primary lyric model leaves the shared ONNX Runtime available to AutoMix. Romanization can run without either model. Maintenance and active alignment hold exclusive access.

## Resource limits

- One task runs at a time in an independent Rust process; completion or cancellation releases its dictionaries, model, and threads
- Computation stays outside the main process and does not block playback controls or lyric animation
- Each native request supports up to 1,000 lines and 64,000 UTF-16 code units, with a 1 MiB limit each for input and output. Primary timing splits full songs into requests automatically
- The translation model accepts up to 512 subwords per input and rejects truncated inputs
- Track changes, source changes, lyric edits, closing the dialog, and cancellation invalidate stale results
- Existing auxiliary display settings, lyric-window synchronization, TTML export, and file saving remain shared

Build targets are Windows, macOS, and Linux on x64/ARM64. See [Alignment validation](/en/native#alignment-validation) for measured performance and platforms actually tested. Model files are platform-independent.
