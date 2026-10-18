---
title: Download
---

# Download Sakura Player

The list below fetches the latest release for the selected channel from GitHub. It prefers Stable, but switches to Beta if no public Stable exists and a Beta is available. Check x64/ARM64 manually because browser architecture detection can be inaccurate. Choose a mirror if GitHub downloads are slow.

<DownloadPage />

## Release channels

| Channel     | Intended audience                | Releases received                        | Example           |
| ----------- | -------------------------------- | ---------------------------------------- | ----------------- |
| **Stable**  | Everyday use                     | Stable                                   | `1.2.0`           |
| **Beta**    | Early feature access             | Beta, then Stable                        | `1.3.0-beta.1`    |
| **Alpha**   | Development and testing          | Alpha, then Beta and Stable              | `1.4.0-alpha.1`   |
| **Nightly** | Following the development branch | Separate rolling release and update feed | `nightly` release |

Change the channel under **Settings → About → Update**. Saved choices are preserved; otherwise the installed version supplies the default. Nightly has a separate update source. The selector above lists only Stable, Beta, and Alpha.

Changing channels starts a fresh check and invalidates downloaded installers from the previous channel. The updater does not automatically downgrade. If the more stable channel has a lower version, download and install it manually.

## Update methods

| Installation form                                          | Capability                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Windows installer                                          | Check, download, and install after an explicit action                         |
| Linux AppImage and identified deb/rpm/pacman installations | In-app updates, subject to installation permissions and package form          |
| macOS, Windows portable, Linux archives                    | Check and open the external download page for manual replacement/installation |
| AppX Store edition                                         | Store-managed updates; in-app channel settings are hidden                     |

The player does not automatically download updates or install them on exit. Use the corresponding buttons. Saving songs is a separate feature; see [Music Downloads](/en/music-downloads).

## Other sources

- **Previous versions:** Browse all archived builds on [GitHub Releases](https://github.com/Sakura520222/Sakura-Player/releases).
- **Development builds:** Download the latest workflow artifact from [GitHub Actions](https://github.com/Sakura520222/Sakura-Player/actions). A GitHub account is required.
- **Nightly:** Visit the separate [rolling Nightly release](https://github.com/Sakura520222/Sakura-Player/releases/tag/nightly).

## Installation notes

- **Windows:** Choose the installer for automatic updates or the single-file portable build.
- **macOS:** If macOS reports that the app is damaged or cannot verify it, see [macOS reports a damaged app](/en/troubleshooting/macos-damaged).
- **Linux:** Choose AppImage if you are unsure which package format your distribution uses. See [Ubuntu sandbox startup failure](/en/troubleshooting/ubuntu-sandbox) for launch errors.

## Linux installation

### Arch Linux

> [!NOTE]
> The `splayer-next` package in the [Arch Linux Chinese Community Repository](https://www.archlinuxcn.org/archlinux-cn-repo-and-mirror/) is the **upstream original SPlayer-Next**, not Sakura Player. Download Sakura Player's `pacman` package from the list above or from [GitHub Releases](https://github.com/Sakura520222/Sakura-Player/releases) and install it manually.

### Linux package formats

| Format   | Distributions                                    |
| -------- | ------------------------------------------------ |
| AppImage | Distribution-independent; no installation needed |
| deb      | Debian, Ubuntu, Linux Mint                       |
| rpm      | Fedora, RHEL, openSUSE                           |
| pacman   | Manjaro                                          |
| tar.gz   | Generic archive for manual extraction            |

```bash
# AppImage
chmod +x ./sakura-player-*.AppImage
./sakura-player-*.AppImage
./sakura-player-*.AppImage --appimage-extract

# deb
sudo apt install ./sakura-player-*.deb

# rpm
sudo dnf install ./sakura-player-*.rpm
sudo zypper install ./sakura-player-*.rpm

# pacman
sudo pacman -U ./sakura-player-*.pacman

# Archive
tar -xzf ./sakura-player-*.tar.gz
cd sakura-player-*/
./Sakura-Player
```
