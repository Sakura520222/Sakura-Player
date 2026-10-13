# Debug Mode and Error Diagnosis

## Developer Tools

Open **Developer Tools** from the gear menu in the upper-right corner. In development builds, press `Ctrl + Shift + I` on Windows/Linux or `Cmd + Option + I` on macOS.

| Panel           | Purpose                           |
| --------------- | --------------------------------- |
| **Console**     | Logs, errors, and stack traces    |
| **Network**     | Network requests and status codes |
| **Application** | Local storage and cached data     |

## Log files

The easiest route is **Settings → About → Open log directory**.

| System  | Path                                                         |
| ------- | ------------------------------------------------------------ |
| Windows | `%APPDATA%\Sakura Player\app-data\logs\`                     |
| macOS   | `~/Library/Application Support/Sakura Player/app-data/logs/` |
| Linux   | `~/.config/Sakura Player/app-data/logs/`                     |

Native module logs are in `app-data/logs/native/`.

## Common checks

- **No playback, stuttering, or silence:** Check Console errors, the source URL, and the selected output device.
- **Cover or lyrics fail:** Inspect failed Network requests and verify that the source is reachable.
- **Broken UI or blank window:** Inspect the Console, clear `app-data/cache/`, and restart.

## Filing an issue

Include the operating system and version, Sakura Player version or commit, complete error output, and reproducible steps. For Linux, also include the desktop environment, distribution, package format or third-party build script, and review [Wayland compatibility](/en/troubleshooting/wayland).

## Resetting the app

::: warning Data loss
Resetting deletes all local user data, including accounts, playlists, settings, and the local library index.
:::

Quit the player and back up the data first. Run these commands only when you intend a full reset. They apply to installed builds; Windows portable builds use `SakuraPlayerData/` beside the executable, which you should back up or clear manually after checking the path. Gatekeeper troubleshooting does not require a reset.

```bat
:: Windows
rd /s /q "%APPDATA%\Sakura Player"
```

```bash
# macOS
rm -rf "$HOME/Library/Application Support/Sakura Player"

# Linux
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/Sakura Player"
```
