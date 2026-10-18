---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Sakura Player"
  text: "听音乐，本该如此"
  tagline: 一款简洁而精致的多平台桌面音乐播放器。支持多种音频格式与丰富的歌词展现形式，性能经过深度优化，每一处细节都恰到好处。基于 SPlayer-Next 的非官方二次开发版本。
  actions:
    - theme: brand
      text: 立即下载
      link: /download
    - theme: alt
      text: 使用指南
      link: /guide
    - theme: alt
      text: GitHub
      link: https://github.com/Sakura520222/Sakura-Player

features:
  - icon: 🎵
    title: 广泛的格式支持
    details: 基于 FFmpeg + Rust 的高性能音频引擎，支持 MP3、FLAC、WAV、AAC、OGG、APE 等众多格式，提供渐入渐出、音量均衡、均衡器与歌曲高潮查询和跳转。
    link: /playback
    linkText: 播放控制与高潮跳转
  - icon: 📝
    title: 丰富的歌词展现
    details: 支持 TTML / LYS / QRC / KRC / YRC / LRC / ASS / SRT，逐字高亮、翻译、音译、复制分享与完整保存，提供多种外部歌词窗口。
    link: /lyrics
    linkText: 歌词使用与保存
  - icon: 🤖
    title: AI 歌词翻译与生成
    details: 自选模型生成翻译、音译与逐字对齐内容，支持补齐缺失、重新生成、流式预览和断点续译，确认后应用并按需保存。
    link: /ai
    linkText: 配置与使用 AI
  - icon: 🌐
    title: 流媒体服务
    details: 接入 Subsonic / Navidrome / Jellyfin / Emby 等自建流媒体服务器，多服务器管理、自动连接，随时随地访问你的曲库。
    link: /streaming
    linkText: 配置媒体源
  - icon: 🎧
    title: 系统级集成
    details: 对接系统媒体控制（Windows SMTC / Linux MPRIS / macOS Now Playing）与 Discord 状态，锁屏、通知栏、耳机线控皆可掌控。
    link: /integrations
    linkText: 服务与听歌识曲
  - icon: 🎨
    title: 自适应主题
    details: 封面取色驱动全站着色，Light / Dark / Auto 自动切换，音乐频谱可视化，细节处处打磨。
  - icon: 🧩
    title: 可扩展能力
    details: 内置插件系统与外部 API（HTTP + WebSocket），可编写脚本扩展音源，或通过接口远程控制播放。
  - icon: 🔤
    title: 本地歌词对齐
    details: 通过日语读音匹配与跨语言语义对齐，将已有翻译、音译关联到主歌词时间轴，在本机预览候选并选择应用。
    link: /lyric-alignment
    linkText: 了解本地对齐
  - icon: 🔌
    title: AI 客户端控制
    details: 内置独立的本机 MCP 服务，让支持 MCP 的 AI 客户端查询播放状态与队列、搜索歌曲并控制播放。
    link: /mcp
    linkText: 连接 MCP
---
