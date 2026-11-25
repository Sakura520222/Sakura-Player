import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  fetchWithProxy: vi.fn(),
}));

vi.mock("@main/utils/logger", () => ({
  coreLog: {
    warn: mocks.warn,
    info: mocks.info,
    error: mocks.error,
  },
}));
vi.mock("@main/utils/proxy", () => ({
  fetchWithProxy: mocks.fetchWithProxy,
}));

import { JFJT_SONG_ENDPOINT, resolveJfjtSong } from "./jfjt";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("主进程 JFJT 受控解析服务", () => {
  it("固定请求 dm.jfjt.cc/Song_V1，不携带 Cookie 且正确校验响应", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 200,
          data: {
            url: "https://m804.music.126.net/secret-token/song.flac",
            name: "晴天",
            ar_name: "周杰伦",
            al_name: "叶惠美",
            pic: "https://p2.music.126.net/cover.jpg",
            size: "24.00MB",
            level: "lossless",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const res = await resolveJfjtSong("186016", "lossless", fetcher);
    expect(res).toEqual({
      ok: true,
      data: {
        url: "https://m804.music.126.net/secret-token/song.flac",
        rawLevel: "lossless",
        jfjtLevel: "lossless",
        size: 24 * 1024 * 1024,
        metadata: {
          name: "晴天",
          artistName: "周杰伦",
          albumName: "叶惠美",
          cover: "https://p2.music.126.net/cover.jpg",
        },
      },
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [endpoint, init] = fetcher.mock.calls[0]!;
    expect(endpoint).toBe(JFJT_SONG_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBe("url=186016&level=lossless&type=json");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers.Referer).toBe("https://dm.jfjt.cc/");
    expect(headers.Cookie).toBeUndefined();
    expect(headers.cookie).toBeUndefined();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("拒绝任意 URL 或非法档位，不发起外部网络请求", async () => {
    const fetcher = vi.fn();
    expect(await resolveJfjtSong("https://evil.example.com/song", "exhigh", fetcher)).toEqual({
      ok: false,
      error: "invalid_song_id",
    });
    expect(await resolveJfjtSong("186016", "higher" as unknown as "standard", fetcher)).toEqual({
      ok: false,
      error: "invalid_level",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("缺少长度头时在流式读取超过上限后立即取消", async () => {
    const cancel = vi.fn();
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (pull.mock.calls.length === 6) controller.close();
    });
    const body = new ReadableStream<Uint8Array>({ pull, cancel });
    expect(await resolveJfjtSong("1", "standard", async () => new Response(body))).toEqual({
      ok: false,
      error: "response_too_large",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull.mock.calls.length).toBeLessThan(6);
  });

  it("超时、HTTP 错误、损坏 JSON 与无效响应均返回失败，且日志不泄露 URL 或敏感正文", async () => {
    const timeoutErr = new DOMException("Timed out", "TimeoutError");
    const timeoutFetcher = vi.fn().mockRejectedValue(timeoutErr);
    expect(await resolveJfjtSong("186016", "exhigh", timeoutFetcher)).toEqual({
      ok: false,
      error: "timeout",
    });

    const httpFetcher = vi.fn().mockResolvedValue(new Response("MUSIC_U=secret", { status: 403 }));
    expect(await resolveJfjtSong("186016", "exhigh", httpFetcher)).toEqual({
      ok: false,
      error: "http_403",
    });

    const badJsonFetcher = vi
      .fn()
      .mockResolvedValue(new Response("<html>secret-token-url</html>", { status: 200 }));
    expect(await resolveJfjtSong("186016", "exhigh", badJsonFetcher)).toEqual({
      ok: false,
      error: "invalid_json",
    });

    const badPayloadFetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 200, data: { url: "ftp://bad.host/secret" } }), {
        status: 200,
      }),
    );
    expect(await resolveJfjtSong("186016", "exhigh", badPayloadFetcher)).toEqual({
      ok: false,
      error: "invalid_payload",
    });

    const logged = mocks.warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("MUSIC_U");
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("ftp://");
  });
});
