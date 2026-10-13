# macOS Reports a Damaged App

macOS may report that Sakura Player is damaged or cannot be checked for malicious software. This is usually Gatekeeper blocking an unsigned application downloaded outside the Mac App Store, not file corruption.

## Remove the quarantine attribute

Open Terminal and run:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/Sakura Player.app"
```

Enter your administrator password, then open the application again.

To remove all extended attributes instead:

```bash
sudo xattr -cr "/Applications/Sakura Player.app"
```

You can also Control-click the app in Finder, choose **Open**, and confirm. This may need to be repeated.

## Apple Silicon

On an M-series Mac, prefer the ARM64 package. The x64 build may require Rosetta 2:

```bash
softwareupdate --install-rosetta --agree-to-license
```

## If it still fails

Quit the player and move `Sakura Player.app` to the Trash in Finder, keeping its user data. Download a fresh copy matching your chip architecture from [GitHub Releases](https://github.com/Sakura520222/Sakura-Player/releases), remove the quarantine attribute, and try again. Gatekeeper troubleshooting does not require clearing your library, sign-ins, or settings.
