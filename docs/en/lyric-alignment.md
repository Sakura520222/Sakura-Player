# Algorithmic lyric alignment

The alignment action beside full-player lyrics maps existing translations and romanization to the original word timings. Tokenization, reading matching, and semantic inference run in the bundled **Rust worker**, without installing Python, PyTorch, or another runtime.

The feature preserves existing text and original timing. It does not recognize audio or generate lyrics. AI lyric translation and model configuration remain independent.

## Using alignment

1. Load original lyrics with actual word timings and an existing translation or romanization
2. Open alignment and select either auxiliary track or both
3. For translation, click **Download or verify model** once; romanization requires no model download
4. Start alignment, inspect each candidate, and select the lines to apply
5. Apply selected lines to update the display immediately; explicitly save lyrics to write files

Complete auxiliary alignments are preserved by default. Enable realignment to recalculate selected tracks. Unselected, unmatched, and unchecked content remains unchanged. The preview reports requested, matched, and previously aligned counts separately.

Line-timed lyrics, missing auxiliary text, and results without two independent timing anchors do not produce word-level candidates. Scores are screening criteria rather than calibrated accuracy estimates; review candidates before applying them.

## Romanization

Lindera/IPADIC provides Japanese morphology and readings. Native WanaKana conversion, global edit distance, and unique reading anchors match existing romanization. Compatibility data preserves the original IPADIC reading order and tie priorities, including ruby hints, particles, long vowels, gemination, spelling variants, and readings spanning multiple timed words.

Chinese pinyin uses dictionary reading candidates and an exact, unique complete match. Tone marks, casing, punctuation, whitespace, and the distinction between `u` and `ü` are retained. Missing words, ambiguous boundaries, or insufficient matches keep the original line.

## Translation

Candle runs the pinned multilingual BERT on the local CPU and extracts layer-eight token vectors, matching the original SimAlign configuration. Rust implements cosine similarity, IterMax, subword and whole-word candidates, semantic heads, phrase expansion, and dictionary-form alternatives in the original priority order.

Chinese segmentation uses ICU dictionary data with the ICU4C minimum-cost path rather than greedy segmentation. Word pairs map to original lyric ranges. Cross-language reordering uses the existing auxiliary timing workflow; translation length never creates timing anchors.

Translation failures preserve completed romanization and existing translations. Details remain available in the dialog.

## Model management

### Download and storage

The model is `google-bert/bert-base-multilingual-cased` at revision `3f076fdb1ab68d5b2880cb87a0886f315b8146f8`, with approximately 714 MB of weights. Downloads respect the player proxy configuration and verify every file's size and SHA-256. The ready marker is published only after native inference succeeds. Prepared alignment runs offline.

Opening the dialog or starting alignment never starts a download automatically. Downloads can be cancelled and retried. Closing the dialog or main window keeps maintenance running; reopening restores progress. Explicitly quitting cancels maintenance and waits for cleanup.

Model files and `ready.json` live in `{userData}/app-data/runtimes/lyric-alignment/`. The native worker is bundled with the application.

**Download or verify model** checks local files first, reuses complete valid files, and downloads only missing or damaged files. Failed verification can be retried without downloading complete model files again.

### Removing the model

The ready marker is independent of absolute paths and platforms, so moving a portable installation does not require downloading the model again. **Remove model** deletes this feature's model directory. Romanization remains available; translation requires preparing the model again. Maintenance and active alignment hold exclusive access.

## Resource limits

- One task runs at a time in an independent Rust process; completion or cancellation releases its dictionaries, model, and threads
- Computation stays outside the main process and does not block playback controls or lyric animation
- Requests allow up to 1,000 lines and 64,000 UTF-16 code units; process input and output are each limited to 1 MiB
- Each model input is limited to 512 subwords; truncated inputs cannot become apparently complete candidates
- Track changes, source changes, lyric edits, closing the dialog, and cancellation invalidate stale results
- Existing auxiliary display settings, lyric-window synchronization, TTML export, and file saving remain shared

Build targets are Windows, macOS, and Linux on x64/ARM64. See [Alignment validation](/en/native#alignment-validation) for measured performance and platforms actually tested. Model files are platform-independent.
