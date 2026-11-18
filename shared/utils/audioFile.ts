import audioFormats from "./audioFormats.json";

/** 文件入口与原生扫描器共用的音频后缀 */
export const SUPPORTED_AUDIO_EXTENSIONS = new Set(audioFormats.map((format) => `.${format}`));

/**
 * 判断文件路径是否为支持的音频格式
 * @param filePath - 文件路径
 */
export const isAudioFile = (filePath: string): boolean => {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return SUPPORTED_AUDIO_EXTENSIONS.has(filePath.slice(dotIndex).toLowerCase());
};
