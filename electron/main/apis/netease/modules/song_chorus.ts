import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 通过现有网易会话查询歌曲副歌时间
 * @param query - 包含歌曲 id 的业务参数
 * @param request - 自动注入会话和签名的请求器
 * @returns 平台原始的毫秒副歌标注
 */
const songChorus: NeteaseModule = (query, request) => {
  const id = String(query.id ?? "");
  if (!/^\d+$/.test(id)) throw new Error("网易歌曲 ID 无效");
  return request("/api/song/chorus", { ids: JSON.stringify([id]) }, createOption(query));
};

export default songChorus;
