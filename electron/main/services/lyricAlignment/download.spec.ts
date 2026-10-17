import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { ReadableStream } from "node:stream/web";

const fetch = vi.hoisted(() => vi.fn());
vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: fetch }));
import { downloadAlignmentAsset } from "./download";
let directory = "";
const data = Buffer.from("portable runtime fixture");
const asset = {
  url: "https://example.invalid/runtime",
  size: data.length,
  sha256: createHash("sha256").update(data).digest("hex"),
};
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "sakura-alignment-download-"));
  fetch.mockReset().mockImplementation(async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    }),
  }));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("运行环境流式下载校验", () => {
  it("分段失败保留原始原因，不被其他分段的取消错误覆盖", async () => {
    const large = { ...asset, size: 16 * 1024 * 1024 };
    fetch.mockImplementation(async (_url, options: RequestInit) => {
      const range = /bytes=(\d+)-(\d+)/.exec((options.headers as Record<string, string>).Range)!;
      const start = Number(range[1]),
        end = Number(range[2]);
      if (start > 0)
        return {
          ok: false,
          status: 503,
          body: new ReadableStream({
            start(controller) {
              controller.close();
            },
          }),
        };
      return {
        ok: true,
        status: 206,
        headers: new Headers({ "content-range": `bytes ${start}-${end}/${large.size}` }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from("partial"));
          },
        }),
      };
    });
    await expect(
      downloadAlignmentAsset(
        large,
        path.join(directory, "runtime"),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("503");
    expect(await readdir(directory)).toEqual([]);
  });
  it("大文件四路写入固定偏移，只有完整哈希通过后才发布", async () => {
    const content = Buffer.alloc(16 * 1024 * 1024, 97);
    const large = {
      ...asset,
      size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    fetch.mockImplementation(async (_url, options: RequestInit) => {
      const range = /bytes=(\d+)-(\d+)/.exec((options.headers as Record<string, string>).Range)!;
      const start = Number(range[1]),
        end = Number(range[2]);
      return {
        ok: true,
        status: 206,
        headers: new Headers({ "content-range": `bytes ${start}-${end}/${content.length}` }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(content.subarray(start, end + 1));
            controller.close();
          },
        }),
      };
    });
    await downloadAlignmentAsset(
      large,
      path.join(directory, "runtime"),
      new AbortController().signal,
      () => {},
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(
      createHash("sha256")
        .update(await readFile(path.join(directory, "runtime")))
        .digest("hex"),
    ).toBe(large.sha256);
    expect(await readdir(directory)).toEqual(["runtime"]);
  });
  it("服务器忽略 Range 时使用完整响应，缺损分段不会发布", async () => {
    const content = Buffer.alloc(16 * 1024 * 1024, 98);
    const large = {
      ...asset,
      size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
    fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(content);
          controller.close();
        },
      }),
    });
    await downloadAlignmentAsset(
      large,
      path.join(directory, "runtime"),
      new AbortController().signal,
      () => {},
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await rm(path.join(directory, "runtime"));
    fetch.mockImplementation(async (_url, options: RequestInit) => {
      const range = /bytes=(\d+)-(\d+)/.exec((options.headers as Record<string, string>).Range)!;
      const start = Number(range[1]),
        end = Number(range[2]);
      return {
        ok: true,
        status: 206,
        headers: new Headers({ "content-range": `bytes ${start}-${end}/${content.length}` }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(content.subarray(start, end));
            controller.close();
          },
        }),
      };
    });
    await expect(
      downloadAlignmentAsset(
        large,
        path.join(directory, "runtime"),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
  it("校验后才发布文件，下载不保留临时副本", async () => {
    await downloadAlignmentAsset(
      asset,
      path.join(directory, "runtime"),
      new AbortController().signal,
      () => {},
    );
    expect(await readFile(path.join(directory, "runtime"))).toEqual(data);
    expect(await readdir(directory)).toEqual(["runtime"]);
  });
  it.each(["hash", "length"])("%s 不匹配时删除部分文件，不发布资产", async (kind) => {
    await expect(
      downloadAlignmentAsset(
        { ...asset, ...(kind === "hash" ? { sha256: "0".repeat(64) } : { size: 1 }) },
        path.join(directory, "runtime"),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
  it("取消中途下载会停止读取并清理文件", async () => {
    const controller = new AbortController();
    await expect(
      downloadAlignmentAsset(asset, path.join(directory, "runtime"), controller.signal, () =>
        controller.abort(),
      ),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
});
