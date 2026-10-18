# 调试模式与错误排查

本文介绍如何定位 Sakura Player 运行中遇到的问题。

## 开发者工具

在右上角的齿轮图标中打开 **开发者工具**。

> [!TIP]
>
> 开发环境中也可以按 `Ctrl + Shift + I`（Windows / Linux）或 `Cmd + Option + I`（macOS）

| 面板            | 用途                   |
| --------------- | ---------------------- |
| **Console**     | 查看日志输出、错误信息 |
| **Network**     | 监控网络请求           |
| **Application** | 查看本地存储、缓存数据 |

## 日志文件

最简单的方式：在 **设置 → 关于软件** 中点击 **打开日志目录**。

日志位于用户数据目录下的 `app-data/logs/`：

| 系统    | 路径                                                         |
| ------- | ------------------------------------------------------------ |
| Windows | `%APPDATA%\Sakura Player\app-data\logs\`                     |
| macOS   | `~/Library/Application Support/Sakura Player/app-data/logs/` |
| Linux   | `~/.config/Sakura Player/app-data/logs/`                     |

原生模块日志位于 `app-data/logs/native/`。

Windows 便携版的实际日志位于 exe 同目录的 `SakuraPlayerData/app-data/logs/`；Linux 使用自定义 `XDG_CONFIG_HOME` 时以对应目录为准。更多位置与备份范围见 [数据管理](/data-management)。

## 常见问题

- **歌曲无法播放 / 卡顿 / 无声**：检查 Console 是否有错误、音频源是否有效、系统输出设备是否正常。
- **封面 / 歌词加载失败**：在 Network 面板查看失败请求与状态码，确认网络与音源可达。
- **界面异常 / 白屏**：查看 Console 错误堆栈，按需在 **设置 → 本地与缓存** 清理对应缓存后重启。自定义缓存位置时以设置页显示的路径为准。

## 提交 Issue

请附上：操作系统与版本、Sakura Player 版本（开发版附 Commit ID）、Console 完整错误日志、可复现的操作步骤。

> [!IMPORTANT]
>
> 如果是 Linux，请先查看 [Linux Wayland 兼容性](./wayland)。报告故障时附带桌面环境、发行版、所使用的安装包格式（官方包）或构建脚本（第三方包）

## 重置应用

完整重置前先退出播放器、备份，并确认实际用户数据目录后再清理。便携版和安装版目录不同，原音乐文件应单独保留。设置中的重置操作不一定删除每个独立存储的文件，请按 [数据管理](/data-management) 区分。普通 Gatekeeper 排错无需重置。
