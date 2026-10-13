import type { Configuration } from "electron-builder";
import { readFileSync } from "node:fs";
import { SUPPORTED_AUDIO_EXTENSIONS } from "./shared/utils/audioFile";

/** 音频后缀注册为文件关联 */
const fileAssociations = [...SUPPORTED_AUDIO_EXTENSIONS].map((extension) => {
  const ext = extension.slice(1);
  return {
    ext,
    name: `SakuraPlayer.${ext}`,
    description: `${ext.toUpperCase()} Audio File`,
    role: "Viewer" as const,
    rank: "Alternate",
  };
});

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const prereleaseChannel = /-(alpha|beta|nightly)(?:\.|$)/.exec(packageVersion)?.[1];
const inferredUpdateChannel = prereleaseChannel ?? "latest";
const updateChannel = process.env.UPDATE_CHANNEL ?? inferredUpdateChannel;

if (
  updateChannel !== "latest" &&
  updateChannel !== "beta" &&
  updateChannel !== "alpha" &&
  updateChannel !== "nightly"
) {
  throw new Error(`不支持的更新通道: ${updateChannel}`);
}
if (packageVersion.includes("-") && !prereleaseChannel) {
  throw new Error(`不支持的预发布版本格式: ${packageVersion}`);
}
if (updateChannel !== inferredUpdateChannel) {
  throw new Error(`版本 ${packageVersion} 与更新通道 ${updateChannel} 不匹配`);
}

const config: Configuration = {
  appId: "io.github.sakura520222.sakuraplayer",
  productName: "Sakura Player",
  // 原始版权属于上游作者 imsyy 及 SPlayer-Next 贡献者，AGPL-3.0 要求保留原署名
  copyright:
    "Copyright © imsyy 2025; SPlayer-Next contributors; Sakura Player maintained by Sakura520222",
  directories: { buildResources: "public" },
  fileAssociations,
  afterPack: "./scripts/after-pack.ts",
  compression: "maximum",
  generateUpdatesFilesForAllChannels: true,
  files: [
    "public/**",
    "out/main/**",
    "out/preload/**",
    "out/renderer/**",
    "!**/.vscode/*",
    "!src/**",
    "!native/**",
    "!scripts/**",
    "!electron/**",
    "!shared/**",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!electron-builder.config.{js,ts,mjs,cjs}",
    "!uno.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,auto-eslint.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}",
    "!{components.d.ts,auto-imports.d.ts}",
    "!{.env,.env.*,.npmrc,pnpm-lock.yaml}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
    "!**/*.{d.ts,ts,map,md}",
    "!**/{CHANGELOG,README,readme}*",
    "!**/node_modules/better-sqlite3/{deps,src}/**",
  ],
  // 保留的语言
  electronLanguages: ["zh-CN", "en-US"],
  asarUnpack: ["public/**"],
  extraResources: [
    {
      from: "native/audio-engine",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/audio-capture",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "resources/afp",
      to: "afp",
      filter: ["afp.mjs", "afp.wasm.mjs"],
    },
    {
      from: "native/media-ctrl",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-lyric",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-thumbnail",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/opencc",
      to: "native",
      filter: ["*.node"],
    },
  ],
  extraFiles: [
    {
      from: "LICENSE",
      to: "LICENSE",
    },
    {
      from: "NOTICE",
      to: "NOTICE",
    },
  ],
  win: {
    executableName: "Sakura-Player",
    icon: "public/icons/logo.ico",
    artifactName: "${name}-${version}-${arch}.${ext}",
    forceCodeSigning: false,
    target: ["nsis", "portable"],
    // Windows 协议由应用设置按需注册，安装器不抢占共享的 orpheus 默认处理器。
  },
  nsis: {
    oneClick: false,
    guid: "io.github.sakura520222.sakuraplayer",
    installerIcon: "public/icons/logo.ico",
    uninstallerIcon: "public/icons/logo.ico",
    installerHeader: "build/installer/header.bmp",
    installerSidebar: "build/installer/sidebar.bmp",
    uninstallerSidebar: "build/installer/sidebar.bmp",
    include: "build/installer/installer.nsh",
    installerLanguages: ["en_US", "zh_CN"],
    artifactName: "${name}-${version}-${arch}-setup.${ext}",
    shortcutName: "Sakura Player",
    uninstallDisplayName: "Sakura Player",
    createDesktopShortcut: "always",
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    license: "build/license.txt",
  },
  portable: {
    artifactName: "${name}-${version}-${arch}-portable.${ext}",
  },
  mac: {
    executableName: "Sakura-Player",
    icon: "public/icons/icon.icns",
    artifactName: "${name}-${version}-${arch}.${ext}",
    identity: null,
    hardenedRuntime: false,
    notarize: false,
    darkModeSupport: true,
    category: "public.app-category.music",
    entitlementsInherit: "public/entitlements.mac.plist",
    extendInfo: {
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
      CFBundleURLTypes: [
        {
          CFBundleURLName: "io.github.sakura520222.sakuraplayer.orpheus",
          CFBundleURLSchemes: ["orpheus"],
        },
      ],
    },
    target: ["dmg", "zip"],
  },
  dmg: {
    artifactName: "${name}-${version}-${arch}.${ext}",
  },
  linux: {
    executableName: "Sakura-Player",
    icon: "public/icons/favicon-512x512.png",
    artifactName: "${name}-${version}-${arch}.${ext}",
    maintainer: "Sakura520222 <sakura520222@outlook.com>",
    category: "Audio;Music;AudioVideo;",
    target: ["AppImage", "deb", "rpm", "tar.gz", "pacman"],
    syncDesktopName: true,
    desktop: { entry: { MimeType: "x-scheme-handler/orpheus;" } },
  },
  appImage: {
    artifactName: "${name}-${version}-${arch}.${ext}",
  },
  pacman: {
    artifactName: "${name}-${version}-${arch}.${ext}",
    depends: [
      "gtk3",
      "libnotify",
      "nss",
      "libxss",
      "libxtst",
      "xdg-utils",
      "at-spi2-core",
      "libsecret",
    ],
  },
  npmRebuild: false,
  electronDownload: {
    mirror: "https://npmmirror.com/mirrors/electron/",
  },
  publish: {
    provider: "github",
    owner: "Sakura520222",
    repo: "Sakura-Player",
    channel: updateChannel,
  },
};

export default config;
