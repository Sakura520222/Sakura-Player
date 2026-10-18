import { kgGatewayRequest } from "../core/request";
import type { KGModule } from "../core/types";

/**
 * 通过现有酷狗会话和客户端版本批量查询高潮区间
 * @param params - 包含逗号分隔歌曲 Hash 的业务参数
 * @returns 平台原始的毫秒高潮标注
 */
const songClimax: KGModule = (params) => {
  const hashes = String(params.hash ?? "")
    .split(",")
    .map((hash) => hash.trim());
  if (!hashes.length || hashes.length > 100 || hashes.some((hash) => !/^[a-f\d]{32}$/i.test(hash)))
    throw new Error("酷狗歌曲 Hash 无效");
  return kgGatewayRequest("/v1/audio_climax/audio", {
    baseURL: "https://expendablekmrcdn.kugou.com",
    params: { data: JSON.stringify(hashes.map((hash) => ({ hash }))) },
  });
};

export default songClimax;
