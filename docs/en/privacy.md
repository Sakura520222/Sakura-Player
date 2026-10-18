# Sakura Player Privacy Policy

**Version: v1.3**<br>
**Effective: October 13, 2026**<br>
**Last updated: October 18, 2026**

> [!IMPORTANT]
> Sakura Player is an unofficial fork of [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next), maintained by [Sakura520222](https://github.com/Sakura520222). “We” in this policy means only this fork's maintainer and contributors to its modifications; it makes no data-processing promises on behalf of imsyy, `SPlayer-Dev`, or third-party service operators. Fork modifications are dated **2026-10-13**. Original copyright and applicable notices are retained in the repository's `NOTICE` and `LICENSE`.

This English translation is provided for convenience. If it differs from the [Chinese policy](/privacy), the Chinese text prevails.

This policy describes how Sakura Player processes, stores, and protects information on your device and the available data controls. It adds no acceptance requirements to rights to use, copy, modify, or redistribute the software under AGPL-3.0.

## 1. Principles

1. **Data minimization:** Only data needed to provide features, protect the application, and preserve your settings is processed.
2. **Local first:** Library metadata, playback history, and preferences remain on your device by default.
3. **Transparency and control:** Local data and optional integrations remain under your control.

## 2. Information processed

### 2.1 Information you provide

- **Third-party credentials:** Addresses, usernames, passwords, tokens, or API keys used for media servers, Last.fm, and AI models. Streaming passwords and AI keys require operating-system secure storage and are refused without it, including the Linux `basic_text` backend. Last.fm session keys prefer encryption but the current implementation still logs a warning and falls back to Base64 when secure storage is unavailable; Base64 is not encryption. Credentials are saved locally and used to communicate with the services you select, not uploaded to a developer-controlled server.
- **Preferences:** Language, theme, shortcuts, audio output, and other settings.

### 2.2 Local runtime and cache data

- Selected music folders, audio metadata, local playlists, lyric caches, and cover thumbnails.
- Local diagnostic logs. They are not uploaded automatically; you must explicitly provide them when requesting support.

## 3. Purpose

The software processes this information to play and organize media, restore your configuration, and maintain local security and stability. It does not use your data for advertising, profiling, or marketing, and does not sell or rent it.

## 4. Third-party services and extensions

1. **Self-hosted media servers:** Traffic is sent directly from your client to the configured server. You and the server operator are responsible for its security and privacy.
2. **Plugins and source extensions:** The optional plugin market performs automated checks and maintainer review, but this is not a complete security audit or endorsement. Community plugins can make their own network requests and process data. Review their source, permissions, and origin before use.
3. **Discord, Last.fm, and similar integrations:** Enabled options send titles, artists, and playback activity through local IPC or the platform API. The service's terms and privacy policy apply.
4. **AI lyrics:** Explicit generation sends required lyric text, song title, artists, and necessary existing auxiliary text to your configured model service. Resume requests can include bounded error feedback. Audio, artwork, local paths, and original timestamps are not sent. The provider sets its retention and billing rules; see [AI Features](/en/ai).
5. **Local alignment and recognition:** Installing translation alignment downloads Python, dependencies, and the model; prepared alignment runs offline. Recognition captures your selected system or microphone audio, generates fingerprints locally, and sends fingerprints and excerpt duration to NetEase for matching. It is not offline; see [Integrations](/en/integrations).

## 5. Storage, retention, and protection

Most data remains in the application's local data directory until you clear it or remove the application data. Streaming passwords and AI keys require secure storage. Last.fm currently retains a logged Base64 fallback when secure storage is unavailable; these policies are distinct. Network features prefer HTTPS/TLS when the destination supports it.

No system can guarantee absolute security. Protect your device and third-party accounts accordingly.

## 6. Your controls

You can inspect local databases and configuration, update preferences and server connections, clear selected caches, or delete the entire application data directory. Uninstalling the executable may not remove the data directory automatically.

## 7. Children

Sakura Player is a general-purpose tool and is not designed to collect information from children. Minors should review this policy and use the software with a guardian.

## 8. Policy updates

Updates are published in this fork's repository documentation and may also be mentioned in release notes or in the application. The date above identifies the latest revision. Revisions do not retroactively change existing AGPL-3.0 grants.

## 9. Contact

- [GitHub Issues](https://github.com/Sakura520222/Sakura-Player/issues)
- Fork maintainer's email: sakura520222@outlook.com
- [Upstream provenance](https://github.com/SPlayer-Dev/SPlayer-Next): upstream authors' contact details are provenance, not privacy contacts for this fork.
