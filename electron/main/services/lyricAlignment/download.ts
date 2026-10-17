import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { fetchWithProxy } from "@main/utils/proxy";
import type { AlignmentDownload } from "./assets";

/**
 * 流式下载固定资产，完整校验长度和 SHA-256 后才发布可执行文件或模型
 * @param asset - 来自内置清单的下载地址和校验值
 * @param destination - 本次专用目录内的目标文件
 * @param signal - 用户取消或应用退出信号
 * @param progress - 已收到的字节数
 */
export const downloadAlignmentAsset = async (
  asset: AlignmentDownload,
  destination: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
): Promise<void> => {
  signal.throwIfAborted();
  const temporary = `${destination}.part`;
  const controller = new AbortController();
  const activeSignal = AbortSignal.any([signal, controller.signal]);
  try {
    const chunkSize = Math.ceil(asset.size / 4);
    const split = asset.size >= 16 * 1024 * 1024;
    const response = await fetchWithProxy(asset.url, {
      signal: activeSignal,
      ...(split ? { headers: { Range: `bytes=0-${chunkSize - 1}` } } : {}),
    });
    const ranged = split && response.status === 206;
    const received = [0, 0, 0, 0];
    /**
     * 将一段响应写入固定文件位置，任一分段失败会取消其他下载
     * @param part - 已收到响应头的分段
     * @param index - 四个固定分段中的下标
     */
    const writePart = async (part: Response, index: number): Promise<void> => {
      const start = ranged ? index * chunkSize : 0;
      const length = ranged ? Math.min(chunkSize, asset.size - start) : asset.size;
      if (
        !part.ok ||
        !part.body ||
        (ranged &&
          (part.status !== 206 ||
            part.headers.get("content-range") !==
              `bytes ${start}-${start + length - 1}/${asset.size}`))
      ) {
        await part.body?.cancel();
        throw new Error(`下载响应无效 (${part.status})`);
      }
      const check = new Transform({
        /**
         * 逐块校验长度并转交写盘，不保留完整下载内容
         * @param chunk - 当前数据块
         * @param _encoding - 流编码
         * @param callback - 写入下一阶段或报告错误
         */
        transform(chunk: Buffer, _encoding, callback) {
          received[index] += chunk.length;
          if (received[index] > length) {
            callback(new Error("下载长度与清单不符"));
            return;
          }
          progress(received.reduce((sum, value) => sum + value, 0));
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(part.body as ReadableStream),
        check,
        createWriteStream(temporary, { flags: ranged ? "r+" : "wx", start }),
        { signal: activeSignal },
      );
      if (received[index] !== length) throw new Error("下载长度与清单不符");
    };
    if (ranged) {
      const file = await open(temporary, "wx");
      try {
        await file.truncate(asset.size);
      } finally {
        await file.close();
      }
      const tasks = [0, 1, 2, 3].map(async (index) => {
        try {
          const part =
            index === 0
              ? response
              : await fetchWithProxy(asset.url, {
                  signal: activeSignal,
                  headers: {
                    Range: `bytes=${index * chunkSize}-${Math.min(asset.size, (index + 1) * chunkSize) - 1}`,
                  },
                });
          await writePart(part, index);
        } catch (error) {
          controller.abort(error);
          throw error;
        }
      });
      const results = await Promise.allSettled(tasks);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw controller.signal.reason;
    } else {
      await writePart(response, 0);
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(temporary)) {
      signal.throwIfAborted();
      hash.update(chunk);
    }
    if (hash.digest("hex") !== asset.sha256) throw new Error("下载校验失败，请重试");
    signal.throwIfAborted();
    await rename(temporary, destination);
  } finally {
    controller.abort();
    await rm(temporary, { force: true });
  }
};
