# AI Features

Sakura Player's **AI Lyric Translation** generates translations, romanization, and word-aligned auxiliary lyrics for the current song, with streamed previews, fill-missing mode, and resumable generation. Add and activate a text model in **Settings → AI Integration → AI Model Configuration**, then open the full-screen player.

## Features and entry points

| Feature                                      | Entry point                                               | Purpose                                                                                      | Setup                                                                             |
| -------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| AI Lyric Translation                         | Language icon to the right of the full-player lyrics      | Generate translation and romanization, mapped to existing lyric timings                      | An active AI model                                                                |
| [Local lyric alignment](/en/lyric-alignment) | Algorithmic lyric alignment beside the full-player lyrics | Map existing translation and romanization to word-timed primary lyrics while preserving text | Romanization works immediately; translation needs the dedicated local environment |
| [MCP interface](/en/mcp)                     | Settings → AI Integration → MCP                           | Let an external AI client search the library, inspect the queue, and control playback        | Enable MCP and configure its URL and connection key in the client                 |

AI Lyric Translation uses your configured model service. Local alignment uses algorithms and models on your device, while MCP exposes playback tools to an external client. They are configured independently; lyric translation does not require MCP.

## Configure an AI model

1. Open **Settings → AI Integration** and click **Add model** in AI Model Configuration.
2. Fill in the fields below and adjust reasoning effort if needed.
3. Click **Test connection** to check the address, model, and key. You can cancel the test.
4. Save the configuration and activate the model you want to use.

| Field              | What to enter                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Configuration name | A display name to distinguish saved configurations                                                   |
| Protocol           | `OpenAI Compatible` or `Anthropic`, matching your service                                            |
| API URL            | The service's API base URL, such as `https://api.example.com/v1`, including any required path prefix |
| Model ID           | The model identifier supported by the service, rather than the configuration's display name          |
| API Key            | The service's key; leave it blank when editing to keep the saved key                                 |

The player appends `/chat/completions` or `/messages` according to the protocol. Enter the base URL without duplicating that endpoint. Only `http://` and `https://` URLs are accepted; embedded credentials, query parameters, and fragments are rejected.

You can save several configurations and switch the active model. A successful connection test confirms one text request; lyric generation also requires SSE streaming support for the selected protocol.

### Reasoning effort

`OpenAI Compatible` configurations offer **Service default, none, minimal, low, medium, high, xhigh, and max**. Service default omits the parameter; support for other values depends on the model and service. `Anthropic` configurations do not use this setting.

If the service rejects the selected effort, edit the model and choose Service default or a supported value. Higher effort generally takes more time and tokens.

## Generate translation and romanization

1. Play a song with lyrics and open the full-screen player.
2. Move the pointer over the lyrics and click the language icon on the right to open **AI Lyric Translation**. Leave immersive mode first if it is enabled.
3. Choose the generation mode, content, and target language when new translation text is needed.
4. Click **Generate** and review the streamed line previews and progress.
5. Once all requested lines have completed and passed validation, review the results and click **Apply selected content**.

Generation requires existing primary lyrics and cannot start while they are loading. It produces auxiliary content from those lyrics; it does not transcribe audio or rebuild the primary timeline.

### Four content options

| Option            | Purpose                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Translation       | Generate line-level translated text                                                         |
| Romanization      | Generate pronunciation in Latin letters, such as Japanese romaji                            |
| Word romanization | Associate pronunciation fragments with source words for word-level display and highlighting |
| Word translation  | Associate translated fragments with source words for timed translation highlighting         |

Missing or incomplete items are selected when the dialog opens, with coverage counts for each option. Unselected auxiliary tracks keep their existing content.

In **Fill missing** mode, selecting only a word-level option aligns existing text where available and generates text where it is missing. For example, select only **Word translation** to add alignment to an existing translation you want to keep.

Translation targets are **Simplified Chinese, Traditional Chinese, English, Japanese, and Korean**. Aligning a complete existing translation does not require choosing a new translation language; romanization follows the source pronunciation.

Word-level options inherit source word time ranges. If the primary lyrics only have line timing, the output uses the whole line interval and cannot supply precise word timings extracted from audio.

### Generation modes

| Mode                         | Behavior                                                                                   | When to use it                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Fill missing (keep existing) | Reuse existing content and process only missing or incomplete lines for the selected tasks | Add missing translation, romanization, or alignment         |
| Regenerate all               | Generate selected content again from the primary lyrics, replacing its text and alignment  | Change the translation language or replace previous results |

Fill missing keeps complete existing translations even when a different target language is selected. To translate the whole song again, choose **Regenerate all** and select Translation.

::: warning Regenerating line text
Regenerating translation or romanization without its corresponding word-level option clears the old alignment for that track. Select both options to update the text and alignment together.
:::

## Cancel, retry, and resume

Click **Cancel generation** to stop. After cancellation or failure, complete validated lines remain in the current dialog. **Resume generation** or **Resume translation** processes the remaining lines. Truncation, missing lines, invalid fields, or invalid word ranges produce diagnostic messages; validation errors show the lyric line number when it can be identified.

- **Resume generation / Resume translation:** Reuse completed lines and include failure feedback in subsequent requests.
- **Generate again:** Restart the current generation plan.
- **Close the dialog, change the song or lyrics, or change the language, selected tasks, or mode:** Clear progress and start a new task.

Progress lasts only for the current dialog session and cannot be restored after quitting the player. Incomplete generation cannot be applied. Previewing or cancelling leaves the current lyrics unchanged.

## Apply, display, and save

**Apply selected content** updates the selected auxiliary tracks together, enables their display options, and synchronizes desktop lyrics, Dynamic Island, and taskbar lyrics. The primary text and timeline are preserved.

In **Settings → Lyrics**, configure translation, romanization, word romanization, and **Word-timed translation**. Turning off Word-timed translation displays the translation line by line.

::: tip Applying still requires a separate save
Applying updates the current lyrics without writing music tags or lyric files automatically. To keep the results, open **Copy Lyrics** beside the lyrics and choose targets under **Save complete lyrics**.
:::

| Save target | Requirements and behavior                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Music tags  | Requires a local file without CUE splitting; preserves the original lyric format and auxiliary translation and romanization data      |
| LRC file    | Saves beside a standalone local audio file with the same base name; other tracks use Save As. Existing matching files are overwritten |
| TTML file   | Requires TTML primary lyrics and an enabled, configured local TTML library; saves there and replaces an existing matched file         |

**Preview changes** compares the selected save targets. For an LRC using Save As, the destination is chosen during saving, so its existing content has not been compared in the preview. Complete saving is independent of the line selections and filters used for copying.

To preserve timed translation fragments, save the auxiliary tracks in **Music tags** or an eligible **TTML file**. LRC retains primary word timings but exports translation line by line; cross-word romanization ranges use a player extension tag. Other players may display the results differently depending on their support for auxiliary tracks and extensions.

## Data and credentials

- Requests are made to the configured model URL when you test a connection, start generation, or resume it.
- Generation sends the song title, artists, requested lyric text or words, and existing translation or romanization needed for the selected tasks. Resume requests also include bounded failure feedback.
- Audio, artwork, local file paths, and original timestamps are not sent. Returned word mappings are converted to timing locally.
- The main process encrypts API keys in local operating-system secure storage. Settings exposes only whether a key is saved. Saving or reusing keys is refused when secure storage is unavailable, including the Linux `basic_text` backend.
- Requests go directly from your device to the configured service. Its operator determines retention, quotas, and billing; testing and generation can both consume usage.

For existing text that you want to process without calling your configured text model, use [local lyric alignment](/en/lyric-alignment). Its translation environment needs an initial resource download, then alignment runs offline on your device.

## Troubleshooting

| Symptom                                                  | What to check                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Asked to enable a model                                  | Save and activate a configuration in AI Integration, then reopen the translation dialog                       |
| Connection test succeeds but generation fails            | Check SSE streaming support, protocol, model access, quota, and the displayed error                           |
| Selected content is complete and generation cannot start | Choose Regenerate all or select an item that is still missing                                                 |
| A new language does not replace existing translation     | Fill missing preserves existing content; use Regenerate all for a full replacement                            |
| Output validation fails or reaches the output limit      | Keep the dialog and task options unchanged and resume; alternatively adjust the model configuration and retry |
| Apply is unavailable                                     | Wait for all requested lines; if the song or lyrics changed, start again                                      |
| Results disappear when reopening a song                  | Save to music tags or lyric files after applying                                                              |

To search songs, inspect the queue, or control playback through an external AI client, see the [MCP interface](/en/mcp).
