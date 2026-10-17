import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { AlignmentSourceLine } from "@shared/types/lyricAlignment";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  request: {
    requestId: "phrases",
    translation: true,
    romanization: false,
    lines: [] as AlignmentSourceLine[],
  },
}));
vi.mock("node:worker_threads", () => {
  const threads = { workerData: mocks.request, parentPort: { postMessage: mocks.post } };
  return { ...threads, default: threads };
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("require", createRequire(import.meta.url));
  mocks.post.mockClear();
  mocks.request.translation = true;
  mocks.request.romanization = false;
});
afterEach(() => vi.unstubAllGlobals());

describe("本地语义短语分组", () => {
  it("保留日语词干、连用动词和英文功能词，行首助词不能成为独立锚点", async () => {
    const lyrics = [
      "曇っていた空から",
      "通じ会える幸せ感じてる",
      "とさしていだけど",
      "In the face of death, changed way of life",
    ];
    mocks.request.lines = lyrics.map((text, id) => ({
      id,
      words: [text],
      translation: "已有翻译",
      romanization: "",
    }));
    await import("./local.worker");
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalled(), { timeout: 5000 });
    const result = mocks.post.mock.calls[0][0];
    expect(result.error).toBeUndefined();
    expect(
      result.lines.map((line: { sourcePhrases: { text: string }[] }) =>
        line.sourcePhrases.map((phrase) => phrase.text),
      ),
    ).toEqual([
      ["曇っていた", "空から"],
      ["通じ会える", "幸せ", "感じてる"],
      ["とさしていだけど"],
      ["In the face", "of death ,", "changed", "way", "of life"],
    ]);
    for (const line of result.lines) {
      expect(line.sourcePhrases.flatMap((phrase: { indices: number[] }) => phrase.indices)).toEqual(
        line.source.map((_: unknown, index: number) => index),
      );
    }
  });

  it("仅音译任务不创建语义短语，保留原有读音匹配", async () => {
    mocks.request.translation = false;
    mocks.request.romanization = true;
    mocks.request.lines = [
      { id: 0, words: ["hello ", "world"], translation: "", romanization: "hello world" },
    ];
    await import("./local.worker");
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const result = mocks.post.mock.calls[0][0];
    expect(result.error).toBeUndefined();
    expect(result.lines[0].sourcePhrases).toEqual([]);
    expect(
      result.lines[0].romanization.parts.map((part: { text: string }) => part.text).join(""),
    ).toBe("hello world");
  });
});
