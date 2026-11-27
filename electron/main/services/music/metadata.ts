import { win32 } from "node:path";

/**
 * 识别歌曲显示字段中回退的本地绝对路径、网络地址和内嵌资源
 * @param value - 待用作元数据的文本
 * @returns 是否应从外网音乐搜索和模型上下文中排除
 */
export const isMediaLocation = (value: string): boolean => {
  const text = value.trim();
  return (
    win32.isAbsolute(text) ||
    /^(?:[a-z][a-z\d+.-]*:\/\/|(?:data|blob|file):|~[/\\]|[a-z]:[^/\n]*\\)/i.test(text)
  );
};

/**
 * 截短发送给模型的曲目显示名，忽略缺失标签时回退的地址或本机路径
 * @param value - 曲名、歌手名或专辑名
 * @returns 可作为音乐元数据发送的文本
 */
export const companionLabel = (value: string): string => {
  const text = value.trim();
  if (isMediaLocation(text)) return "";
  return text.slice(0, 320);
};
