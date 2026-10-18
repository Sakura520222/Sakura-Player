# Online Services and Song Recognition

## Accounts and online pages

Signing into NetEase enables the account's liked playlist, collections, daily recommendations, Personal FM, and cloud-library features where available. Content depends on the account and platform responses.

Manage QQ Music and Kugou accounts in **Settings → Other → Platform login**, using the web login, QR code, or manual Cookie methods shown by the interface. Choose the Kugou variant under platform configuration. One platform's account or entitlements do not apply to other platforms.

Search also supports [independent source plugins](/en/plugins/source#independent). Built-in platforms, plugins, and self-hosted [media sources](/en/streaming) manage their sources and permissions separately.

## Song recognition

Open **Song Recognition** in the top search area to identify system audio or microphone input.

1. Choose **System audio** or **Microphone**.
2. Start recognition. The default capture lasts about 8 seconds and can be cancelled.
3. Wait for fingerprint generation and matching, then review the candidates.
4. Play a candidate or search for the song.

Windows and Linux native modules provide system capture. Where native capture is unavailable, the microphone can use browser capture with operating-system permission. Available sources depend on the detected device capabilities. The player pauses its own playback during recognition and restores it according to session state on completion or cancellation.

Fingerprints are generated locally. Matching sends the fingerprint and excerpt duration to NetEase's recognition endpoint. Recognition needs a network connection, does not provide offline recognition or lyric transcription, and does not use your configured AI model's API key.

If no song is found, try a clearer excerpt and check the input device and volume. Check the network when matching is unavailable. Avoid starting capture on calls or private audio you do not want processed.

## Last.fm

In **Settings → Services → Last.fm**:

1. Enable Last.fm and click **Connect account**.
2. Authorize in the browser, then return and wait for the connected account to appear.
3. Choose whether to submit scrobbles, now-playing updates, and liked-track synchronization.

Authorization can be cancelled. Disconnecting removes the locally saved Last.fm credentials. Enabled features send track titles, artists, and playback activity to Last.fm. Local [statistics](/en/library#history-and-statistics) and Last.fm history remain independent.

Last.fm session keys prefer operating-system `safeStorage`. The current implementation still logs a warning and falls back to Base64 when secure storage is unavailable; Base64 is not encryption. Streaming passwords and AI keys use different policies; see [Privacy](/en/privacy).

NetEase scrobbling is configured separately in **Settings → Player → Scrobble** and is disabled by default. Select a reporting method in the interface. It is separate from local statistics and does not guarantee that the platform counts a play.

## System media controls and Discord

**Settings → Services** provides system media controls and Discord RPC:

- Windows SMTC, Linux MPRIS, and macOS Now Playing integrate playback with the operating system.
- Discord status is disabled by default, with controls for paused display and activity presentation.
- This fork temporarily retains the upstream Discord Application ID and assets, so enabled activity may show the upstream identity.

Windows taskbar hover-cover previews are configured in **Settings → General**. See [Lyrics](/en/lyrics) for lyric-window styles.

## Proxy and external control

**Settings → Services → Network & Proxy** offers Off, HTTP, HTTPS, and SOCKS5 modes with manual host/port configuration and a test action. Successful requests still depend on the destination and proxy being reachable.

HTTP and WebSocket controls are under **Settings → Services → External API**. MCP is under **Settings → AI Integration → MCP**, with its own switch. See [HTTP API](/en/api), [WebSocket API](/en/socket), and [MCP](/en/mcp).
