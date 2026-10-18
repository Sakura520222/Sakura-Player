<!-- agreement-version: 4 -->

# Sakura Player User Agreement and Disclaimer

**Version: v1.3**<br>
**Effective: October 13, 2026**<br>
**Last updated: October 18, 2026**

This English translation is provided for convenience. If it differs from the [Chinese agreement](/agreement), the Chinese text prevails.

> [!IMPORTANT]
> Sakura Player is an **unofficial fork** of [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next), maintained by GitHub user [Sakura520222](https://github.com/Sakura520222). It is not affiliated with the original authors or the `SPlayer-Dev` organization and makes no promises on their behalf. The original software was developed by imsyy and upstream contributors; their copyright, license, and applicable original notices are retained. This agreement describes this fork and third-party risks; it does not make upstream authors service providers or parties to this fork's agreement. Fork modifications are dated **2026-10-13**; provenance and original copyright notices are in the repository's `NOTICE`.

Sakura Player is a free and open-source cross-platform desktop music player. This agreement provides functionality, risk, and responsibility information. **Exercising rights to use, copy, modify, or redistribute the software under AGPL-3.0 does not require separate acceptance of this agreement.** Third-party services have their own terms. Minors should review the relevant features with a guardian.

## 1. Definitions

- **Developer / we:** Only this fork's maintainer, `Sakura520222`, and contributors to this fork's modifications. The upstream author imsyy, the `SPlayer-Dev` GitHub organization, and upstream contributors retain their respective copyrights but assume no maintenance, service, or privacy promises in this fork's agreement.
- **User / you:** Any individual or organization that installs or uses the software.
- **Local content:** Audio stored on your devices or storage you are authorized to access.
- **Online platform:** A public online music service operated independently by a third party.
- **Self-hosted media server:** A Subsonic-compatible, Jellyfin, Emby, or similar server you operate or are authorized to access.
- **Third-party plugin / source:** A community script imported locally or from the network, including compatible LX Music scripts.

## 2. Nature of the software

The software is a client-side tool for decoding, playing, organizing, and managing local audio and, when configured by you, interacting with online platforms, self-hosted servers, or plugins.

It is free software provided without a promise of commercial service, continued maintenance, or support for a particular purpose. Rights to use, copy, modify, and redistribute it are governed by AGPL-3.0.

The software itself does not provide, host, or distribute audio content and does not include online accounts, third-party sources, or copyrighted catalogs. Content and metadata come from your local files, configured services, or plugins, and no warranty is made about them.

## 3. AGPL-3.0 license

Sakura Player is licensed under the GNU Affero General Public License v3.0. The complete license is in `LICENSE`.

When copying, modifying, or redistributing the software, comply with AGPL-3.0, including preserving notices, providing corresponding source where required, identifying modifications, and not imposing incompatible additional restrictions. If a modified version is offered for remote network interaction, AGPL-3.0 section 13 may require offering its complete corresponding source to those users.

The official source repository is <https://github.com/Sakura520222/Sakura-Player>. This agreement explains functionality, third-party risks, trademarks, and applicable law; it does not reduce rights granted by AGPL-3.0. If a conflict exists, AGPL-3.0 prevails.

## 4. Scope and acceptable use

You may use, copy, modify, and redistribute the software under AGPL-3.0, including for personal, research, or commercial purposes.

You must not use the software to violate applicable law, infringe third-party rights, bypass access controls or technical protections, misrepresent official affiliation or endorsement through names or visual assets, scrape or resell protected content unlawfully, or operate an unauthorized public content service.

These are reminders about applicable law, third-party rights, and service terms, not additional software license conditions or restrictions on rights granted by AGPL-3.0.

## 5. Online and third-party features

### 5.1 Online platforms

The software provides general client capabilities that request data when initiated by you. Third-party platforms are independently operated and are not affiliated with or authorized by the developers. Their terms, privacy policies, copyright rules, access controls, and availability apply.

### 5.2 Self-hosted servers

You must be authorized to access each configured server and its content. You are responsible for server availability, legality, and security.

### 5.3 Plugins and sources

The software includes an open extension mechanism and optional plugin market. Market entries index third-party submissions; they are not authored or operated by the Sakura Player developers unless explicitly stated.

Market submissions receive automated checks and maintainer review, but this is not a complete security audit, legal determination, or endorsement. Locally or remotely imported plugins do not pass through market review. Plugins are executable code that can make network requests and persist data, so inspect their source and permissions and install only trusted plugins.

### 5.4 Copyrighted data

The developers claim no ownership over track URLs, metadata, lyrics, covers, or other third-party content. Your access, storage, use, and distribution must comply with applicable law, authorization from rights holders, and platform terms. Technical capability does not grant rights to third-party content.

### 5.5 MCP and external APIs

HTTP, WebSocket, and MCP interfaces are neutral local control mechanisms. You are responsible for actions, data changes, and security risks caused by AI agents, automation scripts, or other clients using them.

## 6. Accounts and credentials

Credentials are used only for requested features and saved on your device. Streaming passwords and AI keys require operating-system `safeStorage` and are not saved when it is unavailable or uses Linux `basic_text`. Last.fm session keys prefer encryption, but currently retain a logged Base64 fallback when secure storage is unavailable; Base64 is not encryption. Credentials are used with the services you select and are not uploaded to a developer-controlled server.

You are responsible for protecting accounts, devices, and credentials.

## 7. Intellectual property and trademarks

Copyright in the original software and this fork's modifications remains with their respective authors and contributors under AGPL-3.0. Rebranding does not transfer ownership of upstream code or visual assets. Trademark rights in “SPlayer”, “SPlayer Next”, and fork-specific names or logos remain with their respective rights holders; do not misrepresent official affiliation, authorization, or endorsement. These trademark matters do not restrict commercial use, modification, or redistribution of the software under AGPL-3.0. Reused upstream visual assets retain their original copyright and applicable licenses. Rights in third-party content remain with their respective owners.

## 8. User responsibility

Use the software lawfully and only with content you own, are authorized to access, or may use under applicable law. The software does not monitor or approve user actions. You are responsible for infringement, unlawful distribution, platform-term violations, and resulting claims or penalties.

## 9. Privacy and local data

The software does not include developer-controlled telemetry or usage analytics and does not upload personally identifiable information to the developers. Configuration, library indexes, queues, history, favorites, covers, caches, and logs are stored locally. Network features communicate directly with the configured third party and are subject to that party's privacy policy. See the [Privacy Policy](/en/privacy).

## 10. Distribution channels and security

This fork publishes version information and packages through <https://github.com/Sakura520222/Sakura-Player>. The upstream original is distributed through <https://github.com/SPlayer-Dev/SPlayer-Next> and its official website <https://splayer-next.imsyy.top>.

Other mirrors, app stores, repackaged builds, and redistributions are not controlled or verified by the developers and are not official releases. They may be modified, outdated, bundled, or malicious.

## 11. Updates

The application may optionally check and download releases from the official repository. No particular release is guaranteed continued maintenance, and development or distribution may change or stop.

## 12. Third-party open-source components

Electron, Vue, FFmpeg, rodio, and other dependencies retain their own copyrights and licenses. Their applicable notices and terms are listed in the source and dependency records.

## 13. Disclaimer

The software is provided **“AS IS” and “AS AVAILABLE”**, without express or implied warranties, including merchantability, fitness for a particular purpose, non-infringement, uninterrupted availability, security, compatibility, or data integrity, to the maximum extent permitted by law.

The developers are not responsible for data loss, device failures, interruption, security incidents, third-party service changes, plugin behavior, or unlawful use, except where liability cannot legally be excluded.

## 14. Limitation of liability

To the maximum extent permitted by law, the developers are not liable for indirect, incidental, special, punitive, or consequential damages. Total liability is limited to the amount you actually paid the developers for the software, if any; the software is normally provided without charge. Mandatory local law may override some limitations.

## 15. Minors

The software is not specifically designed for persons without legal capacity. Minors should use it with guardian consent and supervision.

## 16. Changes

This agreement may be revised for legal or functional changes and published with a release or through official channels. Revisions do not retroactively change existing AGPL-3.0 grants or add acceptance requirements for exercising those rights.

## 17. Governing law and disputes

This agreement is governed by the laws of mainland China, excluding conflict-of-law rules, while mandatory laws in your jurisdiction still apply. The parties should first attempt good-faith negotiation; unresolved disputes may be brought before a court with jurisdiction.

This provision concerns this fork's agreement only to the extent allowed by applicable law. It makes no choice of jurisdiction on behalf of upstream authors, does not change worldwide rights under AGPL-3.0, and does not exclude mandatory local law.

## 18. General terms

If a provision is invalid or unenforceable, the remaining provisions continue to apply. Software license conditions are governed by AGPL-3.0 and applicable third-party licenses. This agreement and the Privacy Policy add no software license conditions and create no service contract with upstream authors. Failure to enforce a right is not a waiver. No agency, partnership, employment, joint venture, or endorsement relationship is created.

## 19. Contact

- [GitHub repository (this fork)](https://github.com/Sakura520222/Sakura-Player)
- [Issue tracker (this fork)](https://github.com/Sakura520222/Sakura-Player/issues)
- [Upstream project](https://github.com/SPlayer-Dev/SPlayer-Next)
- Fork maintainer's email: sakura520222@outlook.com
- Original author's email (retained from the upstream agreement as provenance, not a support or privacy contact for this fork): imsyy1024@gmail.com
