import { fetchWithProxy } from "@main/utils/proxy";
import { coreLog } from "@main/utils/logger";
import type { JfjtLevel, JfjtResolveResponse } from "@shared/types/jfjt";
import {
  isValidJfjtLevel,
  normalizeNeteaseSongId,
  parseJfjtSongResponse,
} from "@shared/utils/jfjt";

/** 固定解析端点，不接受外部传入任意地址 */
export const JFJT_SONG_ENDPOINT = "https://dm.jfjt.cc/Song_V1";
const JFJT_REFERER = "https://dm.jfjt.cc/";
const JFJT_TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type JfjtFetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * 将网络异常归类为不含 URL 或敏感正文的安全错误标识
 * @param err - 捕获到的异常对象
 * @returns 可安全写入日志与回传的错误标识
 */
const classifyError = (err: unknown): string => {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "timeout";
  }
  return "network_error";
};

/**
 * 通过固定主机请求 JFJT 单曲解析接口，不携带任何用户凭据或 Cookie
 * @param songId - 网易云歌曲数字 ID
 * @param level - JFJT 支持的音质档位
 * @param fetcher - 可选请求实现，用于测试注入
 * @returns 结构校验后的解析结果
 */
export const resolveJfjtSong = async (
  songId: string,
  level: JfjtLevel,
  fetcher: JfjtFetcher = fetchWithProxy,
): Promise<JfjtResolveResponse> => {
  const normalizedId = normalizeNeteaseSongId(songId);
  if (!normalizedId) return { ok: false, error: "invalid_song_id" };
  if (!isValidJfjtLevel(level)) return { ok: false, error: "invalid_level" };

  const body = new URLSearchParams({
    url: normalizedId,
    level,
    type: "json",
  }).toString();

  try {
    const response = await fetcher(JFJT_SONG_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: JFJT_REFERER,
        Accept: "application/json",
      },
      body,
      credentials: "omit",
      redirect: "manual",
      signal: AbortSignal.timeout(JFJT_TIMEOUT_MS),
    });

    if (!response.ok) {
      coreLog.warn(`[jfjt] resolve failed: http_${response.status}`);
      return { ok: false, error: `http_${response.status}` };
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      coreLog.warn("[jfjt] resolve failed: response_too_large");
      return { ok: false, error: "response_too_large" };
    }

    const rawText = await response.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_RESPONSE_BYTES) {
      coreLog.warn("[jfjt] resolve failed: response_too_large");
      return { ok: false, error: "response_too_large" };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      coreLog.warn("[jfjt] resolve failed: invalid_json");
      return { ok: false, error: "invalid_json" };
    }

    const parsed = parseJfjtSongResponse(payload);
    if (!parsed) {
      coreLog.warn("[jfjt] resolve failed: invalid_payload");
      return { ok: false, error: "invalid_payload" };
    }

    return { ok: true, data: parsed };
  } catch (err) {
    const reason = classifyError(err);
    coreLog.warn(`[jfjt] resolve failed: ${reason}`);
    return { ok: false, error: reason };
  }
};
