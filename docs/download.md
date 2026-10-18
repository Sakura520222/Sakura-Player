---
title: 下载
---

# 下载 Sakura Player

下方会自动从 GitHub 拉取对应更新通道的最新版本，并根据你的系统推荐安装包。优先选择 Stable；若没有公开 Stable 且有 Beta，会自动切换 Beta。架构识别可能不准确，请按设备手动核对 x64 / ARM64。若下载缓慢，可切换镜像线路。

<DownloadPage />

## 更新通道

| 通道        | 适合人群           | 可收到的版本               | 版本格式示例     |
| ----------- | ------------------ | -------------------------- | ---------------- |
| **Stable**  | 日常使用           | Stable                     | `1.2.0`          |
| **Beta**    | 愿意提前体验新功能 | Beta、后续 Stable          | `1.3.0-beta.1`   |
| **Alpha**   | 开发测试与问题反馈 | Alpha、后续 Beta 和 Stable | `1.4.0-alpha.1`  |
| **Nightly** | 跟踪开发分支       | 独立滚动发行与更新清单     | `nightly` 发行页 |

应用内在 **设置 → 关于软件 → 更新** 中切换更新通道。已有选择会保留；未设置时跟随安装版本的默认通道。Nightly 使用独立更新源，页面上方的下载选择器只列 Stable / Beta / Alpha。

切换通道后会重新检查更新，已下载的旧通道安装包不会继续安装。更新器不自动降级；若更稳定通道的版本号更低，需要手动下载安装。

## 更新方式

| 安装形式                                           | 更新能力                               |
| -------------------------------------------------- | -------------------------------------- |
| Windows 安装版                                     | 检查、下载，用户确认后安装             |
| Linux AppImage、识别为 deb / rpm / pacman 的安装包 | 应用内更新，受系统安装权限与包形式约束 |
| macOS、Windows 便携版、Linux 解压版                | 检查并打开外部下载页，手动替换或安装   |
| AppX 商店版                                        | 由商店管理，应用内通道设置隐藏         |

播放器不会自动下载或在退出时自动安装更新，需使用相应按钮确认。歌曲下载是另一功能，见 [音乐下载](/music-downloads)。

## 其他获取方式

- **历史版本**：前往 [GitHub Releases](https://github.com/Sakura520222/Sakura-Player/releases) 查看全部归档。
- **开发版**：可在 [GitHub Actions](https://github.com/Sakura520222/Sakura-Player/actions) 工作流产物中获取最新构建（需登录 GitHub）。
- **Nightly**：前往独立的 [Nightly 滚动发行](https://github.com/Sakura520222/Sakura-Player/releases/tag/nightly)。

## 安装提示

- **Windows**：提供安装版（含自动更新）与单文件便携版，按需选择。
- **macOS**：首次打开若提示「应用已损坏」或无法验证，请参考 [Mac 应用显示已损坏](/troubleshooting/macos-damaged)。
- **Linux**：不确定发行版格式时优先选择 AppImage；启动异常可参考 [Ubuntu 沙箱启动失败](/troubleshooting/ubuntu-sandbox)。

## Linux 安装

### Arch Linux

> [!NOTE]
> [Arch Linux 中文社区仓库](https://www.archlinuxcn.org/archlinux-cn-repo-and-mirror/) 中的 `splayer-next` 软件包属于上游原版 SPlayer-Next，并非 Sakura Player。请从上方下载列表或 [GitHub Releases](https://github.com/Sakura520222/Sakura-Player/releases) 获取本项目的 `pacman` 安装包后手动安装。

### Linux 安装包选择

| 格式     | 适用发行版                   |
| -------- | ---------------------------- |
| AppImage | 通用 Linux，无需安装         |
| deb      | Debian、Ubuntu、Linux Mint   |
| rpm      | Fedora、RHEL、openSUSE       |
| pacman   | Manjaro                      |
| tar.gz   | 通用压缩包，适合手动解压运行 |

```bash
# AppImage
chmod +x ./sakura-player-*.AppImage
./sakura-player-*.AppImage # 直接运行
./sakura-player-*.AppImage --appimage-extract # 或解压到 squashfs-root 目录

# deb
sudo apt install ./sakura-player-*.deb

# rpm
sudo dnf install ./sakura-player-*.rpm # Fedora
sudo zypper install ./sakura-player-*.rpm # openSUSE

# pacman
sudo pacman -U ./sakura-player-*.pacman

# 压缩包
tar -xzf ./sakura-player-*.tar.gz
cd sakura-player-*/
./Sakura-Player
```
