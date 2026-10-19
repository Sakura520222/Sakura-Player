import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn(), run: vi.fn() }));
vi.mock("./environment", () => ({ acquireAlignmentEnvironment: mocks.acquire }));
vi.mock("./native", () => ({ getAlignmentExecutable: () => "lyric-alignment.exe" }));
vi.mock("./process", () => ({ runAlignmentNative: mocks.run }));
import { alignmentRequestSchema, runLocalAlignment } from "./index";

const request = {
  requestId: "native",
  translation: true,
  romanization: true,
  lines: [{ id: 0, words: ["君", "と"], translation: "与你", romanization: "kimi to" }],
};
const romanization = {
  parts: [
    { text: "kimi ", from: 0, to: 0 },
    { text: "to", from: 1, to: 1 },
  ],
  score: 1,
};
beforeEach(() => {
  mocks.release.mockReset();
  mocks.acquire.mockReset().mockResolvedValue({ modelDirectory: "model", release: mocks.release });
  mocks.run.mockReset().mockResolvedValue(JSON.stringify({ lines: [{ id: 0, romanization }] }));
});
describe("独立原生对齐任务", () => {
  it("整个任务持有模型使用权，只将已有歌词和固定模型目录传入原生进程", async () => {
    const signal = new AbortController().signal;
    const result = await runLocalAlignment(request, signal);
    expect(result.lines[0].romanization).toEqual(romanization);
    expect(mocks.acquire.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.run.mock.invocationCallOrder[0],
    );
    expect(mocks.run).toHaveBeenCalledWith(
      "lyric-alignment.exe",
      ["--model-dir", "model"],
      signal,
      JSON.stringify(request),
    );
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it("模型未下载时仍运行原生音译并返回模型诊断", async () => {
    mocks.acquire.mockRejectedValueOnce(new Error("请先下载模型"));
    expect(await runLocalAlignment(request, new AbortController().signal)).toEqual({
      lines: [{ id: 0, romanization }],
      translationError: "请先下载模型",
    });
    expect(mocks.run.mock.calls[0][1]).toEqual([]);
  });
  it("仅音译时不占用或加载语义模型", async () => {
    await runLocalAlignment({ ...request, translation: false }, new AbortController().signal);
    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.run.mock.calls[0][1]).toEqual([]);
  });
  it("失败或取消后均释放使用权，不接受晚到结果", async () => {
    mocks.run
      .mockRejectedValueOnce(new Error("模型失败"))
      .mockRejectedValueOnce(new Error("原生失败"));
    await expect(runLocalAlignment(request, new AbortController().signal)).rejects.toThrow(
      "原生失败",
    );
    expect(mocks.release).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    mocks.run.mockImplementationOnce(async () => {
      controller.abort();
      return JSON.stringify({ lines: [{ id: 0, romanization }] });
    });
    await expect(runLocalAlignment(request, controller.signal)).rejects.toThrow();
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
  it("模型进程异常退出时只重做音译，保留诊断而不再次加载模型", async () => {
    mocks.run.mockRejectedValueOnce(new Error("模型进程退出"));
    const result = await runLocalAlignment(request, new AbortController().signal);
    expect(result.translationError).toBe("模型进程退出");
    expect(result.lines[0].romanization).toEqual(romanization);
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls[1][1]).toEqual([]);
    expect(JSON.parse(mocks.run.mock.calls[1][3]).translation).toBe(false);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it.each([
    { lines: [] },
    { lines: [{ id: 1 }] },
    { lines: [{ id: 0 }, { id: 0 }] },
    {
      lines: [
        {
          id: 0,
          romanization: { ...romanization, parts: [{ text: "rewritten", from: 0, to: 1 }] },
        },
      ],
    },
    {
      lines: [
        { id: 0, romanization: { ...romanization, parts: [{ text: "kimi to", from: 0, to: 3 }] } },
      ],
    },
  ])("拒绝缺行、重复行、文本改写或越界响应：%j", async (response) => {
    mocks.run.mockResolvedValueOnce(JSON.stringify(response));
    await expect(runLocalAlignment(request, new AbortController().signal)).rejects.toThrow();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it("请求必须具有唯一行号、完整注音边界及受限大小", () => {
    expect(alignmentRequestSchema.safeParse(request).success).toBe(true);
    expect(
      alignmentRequestSchema.safeParse({ ...request, lines: [request.lines[0], request.lines[0]] })
        .success,
    ).toBe(false);
    expect(
      alignmentRequestSchema.safeParse({
        ...request,
        lines: [{ ...request.lines[0], readings: ["きみ"] }],
      }).success,
    ).toBe(false);
  });
});
