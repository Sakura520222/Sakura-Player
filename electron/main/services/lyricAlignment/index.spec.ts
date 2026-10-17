import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  worker: vi.fn(),
  python: vi.fn(),
}));
vi.mock("./environment", () => ({
  acquireAlignmentEnvironment: mocks.acquire,
  alignmentScript: "align.py",
}));
vi.mock("./process", () => ({ runAlignmentPython: mocks.python }));
vi.mock("node:worker_threads", async (original) => {
  const actual = await original<typeof import("node:worker_threads")>();
  const { EventEmitter } = await import("node:events");
  const Worker = class extends EventEmitter {
    /** 记录测试创建的工作线程，便于控制结果和退出时机 */
    constructor() {
      super();
      mocks.worker(this);
    }
    /** 模拟异步释放线程 */
    terminate() {
      return Promise.resolve(0);
    }
  };
  return { ...actual, Worker, default: { ...actual, Worker } };
});
import { runLocalAlignment } from "./index";
const request = {
  requestId: "lease",
  translation: true,
  romanization: true,
  lines: [{ id: 0, words: ["君", "と"], translation: "与你", romanization: "kimi to" }],
};
beforeEach(() => {
  mocks.acquire.mockReset().mockResolvedValue({
    python: "python.exe",
    modelDirectory: "model",
    env: {},
    release: mocks.release,
  });
  mocks.release.mockReset();
  mocks.worker.mockReset();
  mocks.python.mockReset();
});

describe("环境使用权覆盖整个对齐任务", () => {
  it("分词开始前持有环境，分词失败仍释放使用权", async () => {
    const pending = runLocalAlignment(request, new AbortController().signal);
    const rejected = expect(pending).rejects.toThrow("分词失败");
    await vi.waitFor(() => expect(mocks.worker).toHaveBeenCalled());
    expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.worker.mock.invocationCallOrder[0],
    );
    (mocks.worker.mock.calls[0][0] as EventEmitter).emit("message", { error: "分词失败" });
    await rejected;
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it("未安装环境仍可返回已有音译，不调用系统 Python", async () => {
    mocks.acquire.mockRejectedValueOnce(new Error("请先安装环境"));
    const pending = runLocalAlignment(request, new AbortController().signal);
    await vi.waitFor(() => expect(mocks.worker).toHaveBeenCalled());
    const romanization = {
      parts: [
        { text: "kimi ", from: 0, to: 0 },
        { text: "to", from: 1, to: 1 },
      ],
      score: 1,
    };
    (mocks.worker.mock.calls[0][0] as EventEmitter).emit("message", {
      lines: [{ id: 0, source: [], target: ["与你"], romanization }],
    });
    expect(await pending).toEqual({
      lines: [{ id: 0, translation: undefined, romanization }],
      translationError: "请先安装环境",
    });
    expect(mocks.python).not.toHaveBeenCalled();
  });
});
