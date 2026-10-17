# Local Lyric Alignment

The "Smart Alignment" entry on the right side of the full-player lyrics associates existing translations and romanization with the word-level timeline of the primary lyrics. Nothing is re-recognized from audio, no timing is re-created, and no lyric text is generated or rewritten: romanization alignment runs entirely locally, while translation alignment uses a self-contained local Python environment installed by the app.

## The Two Alignment Tasks

Alignment here covers two distinct tasks:

- **Word-level romanization alignment**: word-timed lyrics with timestamps already exist; match the existing romaji to each source fragment and inherit the timestamps.
- **Word-level translation alignment**: source word timing already exists; semantically match an existing Chinese or English translation to the corresponding source fragments, then derive a word-level timeline for the translation.

Both build a mapping between the source and auxiliary text while keeping the primary timeline. For one lyric line:

| Primary lyrics (word timing exists) | Existing romaji     | Existing translation |
| ----------------------------------- | ------------------- | -------------------- |
| 君 `10.00–10.40`                    | `kimi to mita yume` | `与你一同看过的梦`   |
| と `10.40–10.65`                    |                     |                      |
| 見た `10.65–11.25`                  |                     |                      |
| 夢 `11.25–12.00`                    |                     |                      |

The ideal output keeps the primary timeline and produces:

- Romanization: `kimi` `10.00–10.40`, `to` `10.40–10.65`, `mita` `10.65–11.25`, `yume` `11.25–12.00`
- Translation (semantic phrases): `与你一同` `10.00–10.65`, `看过的` `10.65–11.25`, `梦` `11.25–12.00`

> The example is hand-crafted to illustrate the target format, not an actual model result.

## Romanization: Reading Match + Edit Distance

Splitting the romaji by spaces and pairing by index does not work — a single kanji may span multiple morae, and one romaji token may span multiple source characters. `今日` reads as `kyou`, so the two kanji cannot each be assigned one romaji word. The right approach is to associate reading units first, then derive romaji timestamps from the source time boundaries.

Sakura Player implements this as:

- [Kuromoji](https://github.com/takuyaa/kuromoji.js) (Apache-2.0, bundled with the IPADIC dictionary) tokenizes the Japanese text and produces candidate readings;
- [WanaKana](https://github.com/WaniKani/WanaKana) (MIT) converts kana and romaji to a uniform reading representation;
- Global edit-distance matching aligns the existing romaji, allowing a whole token to span multiple source fragments (e.g. `今` `日` jointly mapping to `kyou`).

Original casing, whitespace, and punctuation are preserved verbatim from the source slices. The feature targets Japanese romaji; lines the dictionary cannot handle or that score too low keep their existing content. Romanization alignment needs no Python environment and works out of the box.

## Translation: Cross-Lingual Word Alignment + Time Mapping

Translation alignment uses [SimAlign](https://github.com/cisnlp/simalign) (MIT). It builds word alignments from cross-lingual vector similarity of a pretrained multilingual BERT, with no need to collect parallel corpora and train a model.

Flow: word-timed source with timestamps → Chinese segmentation (runtime ICU `Intl.Segmenter`, no jieba install) → SimAlign IterMax matches source words to translation words → word indices map back to source times → cross-lingual reordering and one-to-many mappings merge into semantic phrases.

Semantic alignment is not the same as chronological alignment: Japanese versus Chinese or English involves reordering, additions, omissions, and many-to-one word mappings. Therefore:

- Reordered and one-to-many matches merge into semantic phrases instead of splitting time mechanically by translation length;
- The match score is only a filter — lines scoring below the threshold (0.65) keep their existing alignment rather than receiving invented timestamps;
- The algorithm only outputs index pairs, text is preserved verbatim, and every line can be reviewed in the preview before applying.

## Candidate Open-Source Projects

The following projects were surveyed during design. Each solves one piece — semantic mapping, reading processing, or lyric format handling — and none turns three lyric tracks into a perfect word-level alignment in one step:

| Project                                                         | Core Capability                                        | Notes                                                |
| --------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| [SimAlign](https://github.com/cisnlp/simalign)                  | Multilingual word semantic alignment                   | ✅ Adopted for translation alignment                 |
| [awesome-align](https://github.com/neulab/awesome-align)        | Multilingual BERT word alignment                       | Alternative, BSD-3-Clause                            |
| [Cross-Align](https://github.com/lisasiyu/Cross-Align)          | Deep cross-lingual interactive word alignment          | High-precision research direction                    |
| Kuroshiro                                                       | Japanese tokenization, kana, romaji conversion         | Its underlying Kuromoji + WanaKana are used directly |
| [LDDC](https://github.com/chenmozhijin/LDDC)                    | Word lyrics, translation, romaji processing            | Data flow reference only; no source copied           |
| [AMLL TTML](https://github.com/amll-dev/applemusic-like-lyrics) | Parsing and export of word lyrics, translation, romaji | Format reference; no source copied                   |

## Runtime Environment

Translation alignment requires a local Python environment. Clicking "Install Environment" in the alignment dialog has the player download a portable Python, create a virtual environment, install dependencies, fetch the model, and run an inference check; merely opening the dialog never triggers an install.

- The portable interpreter comes from [Python Standalone Builds](https://github.com/astral-sh/python-build-standalone), pinned to CPython 3.12.15, with length and built-in SHA-256 checks at install time;
- Windows, macOS, and Linux on x64 and ARM64 are covered; Windows ARM64 uses the x64 interpreter and dependencies and requires x64 app support;
- macOS uses PyTorch 2.2.2 with NumPy 1.26.4 for Intel Mac compatibility; Windows / Linux install from the official PyTorch CPU index with no CUDA downloads;
- The Windows VC++ runtime is installed into the dedicated virtual environment via `msvc-runtime`, so no system component is required;
- The model is pinned to a specific revision of `google-bert/bert-base-multilingual-cased`, verified per-file by SHA-256 in safetensors format;
- Downloads follow the player's network proxy settings; verification and alignment run fully offline once the model is prepared.

Everything lives under `{userData}/app-data/runtimes/lyric-alignment/` — the system Python is never read, PATH is never modified, and global Python packages or the Hugging Face cache are never used. Installation shows staged progress and can be cancelled or retried; it continues in the background after the dialog closes, while quitting the player cancels the install and waits for cleanup. "Uninstall Environment" removes the Python, virtual environment, model, and caches. Without an installed environment, unchecking translation still allows romanization alignment.

## Usage and Behavior

- Only real word-timed primary lyrics are processed; fully aligned tracks and tracks missing auxiliary text are skipped by default. Checking "Re-align existing word-level translations and romanization" re-processes the selected auxiliary tracks;
- Individual lines can be deselected in the preview; poorly matched lines keep their current text;
- Only one task runs at a time; each task owns the worker and Python subprocess, and dictionaries and the model are released afterwards;
- Input is limited to 1,000 lines and 64,000 characters in total;
- Applying reuses the existing auxiliary TTML saving and external lyric window sync; the source text and primary timestamps stay unchanged;
- If model loading or inference fails, completed romanization can still be applied alone and the translation is left untouched.

## Design Trade-offs

- **No audio forced alignment**: Whisper, MFA, and similar models would re-recognize audio at a cost that never pays off here;
- **No LLM fallback**: alignment only associates existing text; low-confidence content is left as-is for manual correction in the preview;
- **Never damages existing lyrics**: rewritten, out-of-range, or low-score results are rejected, and translation and romaji text are always preserved verbatim.

No verified open-source library yet turns arbitrary line-level translations and romaji into high-quality word-level timelines. This feature combines reading matching with cross-lingual word alignment on top of that groundwork: romanization aims for precise automatic alignment, translation aligns semantically, and anything unreliable is surfaced for the user to decide.

## Format and Licenses

- AMLL's TTML format supports word-level romanization and translation data, but AMLL Player renders word-level translations line by line. This feature reuses the existing auxiliary TTML saving path, so external players without word-level translation support degrade to line display automatically.
- Licenses must be checked independently when integrating: SimAlign is MIT, Kuromoji is Apache-2.0 (bundling the IPADIC dictionary), WanaKana is MIT, awesome-align is BSD-3-Clause, the AMLL main repository is AGPL-3.0, and LDDC is GPL-3.0. This feature copies no source from LDDC or AMLL; copyright and license notices of the dependencies remain in their distribution packages.
