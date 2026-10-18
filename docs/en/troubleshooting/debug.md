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

Windows portable logs live in `SakuraPlayerData/app-data/logs/` beside the executable. Linux follows a custom `XDG_CONFIG_HOME` when configured. See [Data Management](/en/data-management) for locations and backup scope.

## Common checks

- **No playback, stuttering, or silence:** Check Console errors, the source URL, and the selected output device.
- **Cover or lyrics fail:** Inspect failed Network requests and verify that the source is reachable.
- **Broken UI or blank window:** Inspect the Console and clear the relevant category under **Settings → Local & Cache** before restarting. For a custom cache location, use the path shown in Settings.

## Filing an issue

Include the operating system and version, Sakura Player version or commit, complete error output, and reproducible steps. For Linux, also include the desktop environment, distribution, package format or third-party build script, and review [Wayland compatibility](/en/troubleshooting/wayland).

## Resetting the app

A complete reset requires quitting, backing up, and identifying the actual user-data directory before removing it. Portable and installed builds use different locations; original music files should be kept separately. Settings reset actions do not necessarily remove every independently stored file. Follow [Data Management](/en/data-management) to distinguish these operations. Gatekeeper troubleshooting does not require a reset.
