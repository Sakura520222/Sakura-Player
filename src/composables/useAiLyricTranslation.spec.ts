import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, nextTick, reactive, ref } from "vue";
import { parseLyric } from "lyric-kit";
import type {
  AiCompletionResult,
  AiModelApi,
  AiModelConfig,
  AiRequestResult,
} from "@shared/types/ai";
import type { Track } from "@shared/types/player";
import type { LyricLine } from "@shared/types/lyrics";
import { ALIGNMENT_LINES, ALIGNMENT_RESULT } from "@shared/testFixtures/lyricAlignment";

let media: {
  track: Track | null;
  parsedLyric: LyricLine[];
  lyricRevision: number;
  lyricLoading: boolean;
  applyLyricTranslation: ReturnType<typeof vi.fn>;
  applyAlignedLyricTranslation: ReturnType<typeof vi.fn>;
};
vi.mock("@/stores/media", () => ({ useMediaStore: () => media }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { useAiLyricTranslation } from "./useAiLyricTranslation";

const active: AiModelConfig = {
  id: "active",
  name: "启用模型",
  protocol: "openai-compatible",
  model: "fixture",
  baseUrl: "https://example.invalid/v1",
  hasApiKey: true,
};
const api = {
  list: vi.fn<AiModelApi["list"]>(),
  stream: vi.fn<AiModelApi["stream"]>(),
  cancel: vi.fn<AiModelApi["cancel"]>(),
};
const result = (text: string, finishReason = "stop"): AiRequestResult<AiCompletionResult> => ({
  status: "completed",
  data: { text, model: "fixture", finishReason, usage: null },
});
const output = '{"id":0,"translation":"雨后的光"}\n{"id":1,"translation":"与你同行"}';
const wrappers: ReturnType<typeof mount>[] = [];
const setup = async () => {
  const open = ref(true);
  let translation!: ReturnType<typeof useAiLyricTranslation>;
  const wrapper = mount(
    defineComponent({
      setup() {
        translation = useAiLyricTranslation(open);
        return () => null;
      },
    }),
  );
  wrappers.push(wrapper);
  translation.mode.value = "line";
  await flushPromises();
  return { ...translation, open, wrapper };
};

beforeEach(() => {
  media = reactive({
    track: {
      id: "song",
      source: "local",
      title: "Fixture",
      artists: [{ id: "a", name: "Writer" }],
      duration: 5000,
    },
    parsedLyric: parseLyric("[00:01]A light after the rain\n[00:03]Walking with you").lines,
    lyricRevision: 1,
    lyricLoading: false,
    applyLyricTranslation: vi.fn(() => true),
    applyAlignedLyricTranslation: vi.fn(() => true),
  });
  api.list.mockReset().mockResolvedValue({ models: [active], activeModelId: active.id });
  api.stream.mockReset();
  api.cancel.mockReset().mockResolvedValue(true);
  Object.defineProperty(window, "api", { configurable: true, value: { aiModel: api } });
});
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

describe("AI 歌词翻译任务生命周期", () => {
  it("智能模式逐行预览音译与译文，完整校验后才一次应用两条逐字轨道", async () => {
    media.parsedLyric = structuredClone(ALIGNMENT_LINES);
    const state = await setup();
    state.mode.value = "aligned";
    await nextTick();
    const text = JSON.stringify({ id: 0, ...ALIGNMENT_RESULT });
    api.stream.mockImplementation(async (request, delta) => {
      expect(JSON.parse(request.messages[1].content).lines[0].words).toHaveLength(3);
      expect(request.maxTokens).toBe(4096);
      delta(text.slice(0, 20));
      expect(state.canApply.value).toBe(false);
      delta(text.slice(20) + "\n");
      expect(state.rows.value[0].romanization).toBe("kimi to aruku");
      expect(media.applyAlignedLyricTranslation).not.toHaveBeenCalled();
      return result(text, "end_turn");
    });
    await state.start();
    expect(state.rows.value[0].translation).toBe("Walk with you");
    expect(state.apply()).toBe(true);
    expect(media.applyAlignedLyricTranslation).toHaveBeenCalledWith(
      1,
      new Map([[0, ALIGNMENT_RESULT]]),
      "zh-CN",
    );
    expect(media.applyLyricTranslation).not.toHaveBeenCalled();
    state.mode.value = "line";
    expect(state.apply()).toBe(false);
  });

  it("智能模式取消时保留原歌词，迟到的完整对齐结果也不可应用", async () => {
    media.parsedLyric = structuredClone(ALIGNMENT_LINES);
    const state = await setup();
    state.mode.value = "aligned";
    await nextTick();
    let resolve!: (value: AiRequestResult<AiCompletionResult>) => void;
    api.stream.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const running = state.start();
    await flushPromises();
    state.cancel();
    resolve(result(JSON.stringify({ id: 0, ...ALIGNMENT_RESULT })));
    await running;
    expect(state.canApply.value).toBe(false);
    expect(media.applyAlignedLyricTranslation).not.toHaveBeenCalled();
  });

  it.each([
    { count: 19, words: 3, batches: 4 },
    { count: 3, words: 31, batches: 3 },
  ])(
    "逐字任务按行数及字词数拆分，保持 4096 输出上限：$count 行 $words 词",
    async ({ count, words, batches }) => {
      media.parsedLyric = Array.from({ length: count }, (_, index) => ({
        ...ALIGNMENT_LINES[0],
        startTime: index * 5000,
        words: Array.from({ length: words }, () => ({
          word: "君",
          startTime: index * 5000,
          endTime: index * 5000 + 1000,
        })),
      }));
      const state = await setup();
      state.mode.value = "aligned";
      await nextTick();
      api.stream.mockImplementation(async (request) => {
        expect(request.maxTokens).toBe(4096);
        const payload = JSON.parse(request.messages[1].content) as {
          lines: { id: number; words: { index: number }[] }[];
        };
        expect(payload.lines.length).toBeLessThanOrEqual(6);
        expect(payload.lines.reduce((sum, line) => sum + line.words.length, 0)).toBeLessThanOrEqual(
          60,
        );
        return result(
          payload.lines
            .map((line) =>
              JSON.stringify({
                id: line.id,
                translation: [
                  { text: "you", from: line.words[0].index, to: line.words.at(-1)!.index },
                ],
                romanization: line.words.map(({ index }) => ({ index, text: "kimi" })),
              }),
            )
            .join("\n"),
        );
      });
      await state.start();
      expect(api.stream).toHaveBeenCalledTimes(batches);
      expect(state.translatedCount.value).toBe(count);
      expect(state.canApply.value).toBe(true);
    },
  );
  it("没有启用模型、没有歌词或正在加载时不能启动", async () => {
    api.list.mockResolvedValue({ models: [active], activeModelId: null });
    const state = await setup();
    expect(state.canStart.value).toBe(false);
    await state.start();
    expect(state.error.value).toBe("player.aiTranslation.noModel");
    expect(api.stream).not.toHaveBeenCalled();
    media.lyricLoading = true;
    await state.start();
    expect(api.stream).not.toHaveBeenCalled();
    media.lyricLoading = false;
    media.parsedLyric = [];
    media.lyricRevision++;
    await nextTick();
    expect(state.canStart.value).toBe(false);
  });

  it("按文本长度限制批次，保留重复歌词的独立行号", async () => {
    media.parsedLyric = Array.from({ length: 3 }, (_, index) => ({
      ...media.parsedLyric[0],
      startTime: index * 1000,
      words: [{ word: "x".repeat(2500), startTime: index * 1000, endTime: index * 1000 + 1000 }],
    }));
    const state = await setup();
    api.stream.mockImplementation(async (request) => {
      const payload = JSON.parse(request.messages[1].content) as { lines: { id: number }[] };
      expect(payload.lines.length).toBe(1);
      return result(
        payload.lines.map(({ id }) => JSON.stringify({ id, translation: `第${id}行` })).join("\n"),
      );
    });
    await state.start();
    expect(api.stream).toHaveBeenCalledTimes(3);
    expect(state.rows.value.map((row) => row.translation)).toEqual(["第0行", "第1行", "第2行"]);
    expect(state.canApply.value).toBe(true);
  });
  it("启动时重新获取当前启用模型，完整行流式预览，完成后才允许原子应用", async () => {
    const state = await setup();
    api.list.mockResolvedValue({
      models: [{ ...active, id: "new-active", protocol: "anthropic" }],
      activeModelId: "new-active",
    });
    api.stream.mockImplementation(async (request, delta) => {
      expect(request.modelId).toBe("new-active");
      delta('{"id":0,"translation":"雨后');
      expect(state.translatedCount.value).toBe(0);
      delta('的光"}\n');
      expect(state.rows.value[0].translation).toBe("雨后的光");
      expect(state.canApply.value).toBe(false);
      expect(media.applyLyricTranslation).not.toHaveBeenCalled();
      return result(output);
    });
    await state.start();
    expect(state.phase.value).toBe("completed");
    expect(state.translatedCount.value).toBe(2);
    expect(state.canApply.value).toBe(true);
    expect(state.apply()).toBe(true);
    expect(media.applyLyricTranslation).toHaveBeenCalledWith(
      1,
      new Map([
        [0, "雨后的光"],
        [1, "与你同行"],
      ]),
      "zh-CN",
    );
  });

  it("隐藏窗口没有增量时仍通过最终完整响应恢复结果", async () => {
    const state = await setup();
    api.stream.mockResolvedValue(result(output, "end_turn"));
    await state.start();
    expect(state.rows.value.map((row) => row.translation)).toEqual(["雨后的光", "与你同行"]);
    expect(state.canApply.value).toBe(true);
  });

  it.each(["cancel", "close", "unmount", "source", "language"])(
    "%s 后中断请求并忽略迟到的成功响应",
    async (action) => {
      const state = await setup();
      let resolve!: (value: AiRequestResult<AiCompletionResult>) => void;
      let delta!: (value: string) => void;
      api.stream.mockImplementation((_request, callback) => {
        delta = callback;
        return new Promise((done) => {
          resolve = done;
        });
      });
      const running = state.start();
      await flushPromises();
      delta('{"id":0,"translation":"部分译文"}\n');
      if (action === "cancel") state.cancel();
      else if (action === "close") state.open.value = false;
      else if (action === "unmount") state.wrapper.unmount();
      else if (action === "source") media.lyricRevision++;
      else state.targetLanguage.value = "ja";
      await nextTick();
      expect(api.cancel).toHaveBeenCalledWith(api.stream.mock.calls[0][0].requestId);
      delta('{"id":1,"translation":"迟到译文"}\n');
      resolve(result(output));
      await running;
      expect(state.canApply.value).toBe(false);
      expect(state.apply()).toBe(false);
      expect(state.busy.value).toBe(false);
      expect(media.applyLyricTranslation).not.toHaveBeenCalled();
    },
  );

  it.each(["source", "language"])(
    "%s 同步变化时即使 watcher 尚未触发也不能应用已完成的译文",
    async (change) => {
      const state = await setup();
      api.stream.mockResolvedValue(result(output));
      await state.start();
      if (change === "source") media.lyricRevision++;
      else state.targetLanguage.value = "ja";
      expect(state.apply()).toBe(false);
    },
  );

  it("取消模型列表等待时不会创建网络请求，关闭后迟到列表不保留配置", async () => {
    const state = await setup();
    let resolve!: (value: Awaited<ReturnType<AiModelApi["list"]>>) => void;
    api.list.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const running = state.start();
    state.cancel();
    state.open.value = false;
    await nextTick();
    resolve({ models: [active], activeModelId: active.id });
    await running;
    expect(api.stream).not.toHaveBeenCalled();
    expect(state.model.value).toBeNull();
  });

  it("获取当前模型失败时不能继续使用弹窗打开时的旧配置", async () => {
    const state = await setup();
    api.list.mockRejectedValue(new Error("unavailable"));
    await state.start();
    expect(api.stream).not.toHaveBeenCalled();
    expect(state.phase.value).toBe("error");
    expect(state.error.value).toBe("player.aiTranslation.modelLoadFailed");
  });

  it.each(["invalid", "missing", "length", "max_tokens", "provider-error"])(
    "%s 输出不应用，重试前释放上一任务",
    async (failure) => {
      const state = await setup();
      api.stream.mockImplementation(async (_request, delta) => {
        if (failure === "invalid") delta('{"id":99,"translation":"错行"}\n');
        if (failure === "provider-error") return { status: "error", error: "provider failed" };
        return result(
          failure === "missing" ? '{"id":0,"translation":"只有一行"}' : output,
          failure,
        );
      });
      await state.start();
      expect(state.phase.value).toBe("error");
      expect(state.canApply.value).toBe(false);
      expect(state.busy.value).toBe(false);
      if (failure === "invalid") expect(api.cancel).toHaveBeenCalledOnce();
      api.stream.mockResolvedValue(result(output));
      await state.start();
      expect(state.canApply.value).toBe(true);
    },
  );

  it("长歌词分批顺序处理，后续批次失败时整首不可应用", async () => {
    media.parsedLyric = Array.from({ length: 81 }, (_, index) => ({
      ...media.parsedLyric[0],
      startTime: index * 1000,
    }));
    const state = await setup();
    let requests = 0;
    api.stream.mockImplementation(async (request) => {
      const payload = JSON.parse(request.messages[1].content) as { lines: { id: number }[] };
      expect(payload.lines.length).toBeLessThanOrEqual(40);
      if (++requests === 3) return { status: "error", error: "last batch failed" };
      return result(
        payload.lines.map(({ id }) => JSON.stringify({ id, translation: `第${id}行` })).join("\n"),
      );
    });
    await state.start();
    expect(api.stream).toHaveBeenCalledTimes(3);
    expect(state.translatedCount.value).toBe(80);
    expect(state.canApply.value).toBe(false);
    expect(media.applyLyricTranslation).not.toHaveBeenCalled();
  });

  it.each(
    (["line", "aligned"] as const).flatMap((mode) =>
      ["malformed", "missing", "length", "provider-error"].map((failure) => ({ mode, failure })),
    ),
  )("$mode 的 $failure 保留完整行，续译仅请求缺行且保留原行号", async ({ mode, failure }) => {
    media.parsedLyric = Array.from({ length: 5 }, (_, id) => ({
      ...structuredClone(ALIGNMENT_LINES[0]),
      words: id === 1 ? [] : structuredClone(ALIGNMENT_LINES[0].words),
    }));
    const state = await setup();
    state.mode.value = mode;
    await nextTick();
    const record = (id: number) =>
      JSON.stringify(
        mode === "aligned" ? { id, ...ALIGNMENT_RESULT } : { id, translation: `译文${id}` },
      );
    const partial = [record(3), record(0)].join("\n");
    api.stream.mockImplementationOnce(async (_request, delta) => {
      if (failure === "malformed") {
        delta(partial + '\n{"id":2,"translation":false}\n');
        return { status: "cancelled" };
      }
      if (failure === "provider-error") {
        delta(partial + "\n");
        return { status: "error", error: "connection lost" };
      }
      return result(partial + (failure === "length" ? '\n{"id":2' : ""), failure);
    });
    await state.start();
    expect(state.phase.value).toBe("error");
    expect(state.translatedCount.value).toBe(2);
    expect(state.canResume.value).toBe(true);
    expect(state.apply()).toBe(false);
    const kept = state.rows.value.filter((row) => row.translation);
    api.stream.mockImplementationOnce(async (request, delta) => {
      expect(JSON.parse(request.messages[1].content).lines.map(({ id }) => id)).toEqual([2, 4]);
      expect(state.canResume.value).toBe(false);
      delta(record(2) + "\n");
      expect(state.canApply.value).toBe(false);
      expect(state.translatedCount.value).toBe(3);
      return result([record(2), record(4)].join("\n"));
    });
    await state.resume();
    expect(state.phase.value).toBe("completed");
    expect(state.canResume.value).toBe(false);
    expect(state.translatedCount.value).toBe(4);
    expect(state.rows.value.filter((row) => [0, 3].includes(row.id))).toEqual(kept);
    expect(state.apply()).toBe(true);
    if (mode === "aligned") {
      expect(media.applyAlignedLyricTranslation).toHaveBeenCalledWith(
        1,
        new Map([0, 2, 3, 4].map((id) => [id, ALIGNMENT_RESULT])),
        "zh-CN",
      );
    } else {
      expect(media.applyLyricTranslation).toHaveBeenCalledWith(
        1,
        new Map([0, 2, 3, 4].map((id) => [id, `译文${id}`])),
        "zh-CN",
      );
    }
    await state.resume();
    expect(api.stream).toHaveBeenCalledTimes(2);
  });

  it("45 行逐字任务在 9 行处失败后，从第 10 行继续分批完成", async () => {
    media.parsedLyric = Array.from({ length: 45 }, () => structuredClone(ALIGNMENT_LINES[0]));
    const state = await setup();
    state.mode.value = "aligned";
    await nextTick();
    const requested: number[][] = [];
    api.stream.mockImplementation(async (request) => {
      const ids = JSON.parse(request.messages[1].content).lines.map(({ id }) => id) as number[];
      requested.push(ids);
      return result(
        (requested.length === 2 ? ids.slice(0, 3) : ids)
          .map((id) => JSON.stringify({ id, ...ALIGNMENT_RESULT }))
          .join("\n"),
      );
    });
    await state.start();
    expect(state.translatedCount.value).toBe(9);
    await state.resume();
    expect(requested.slice(2).flat()).toEqual(Array.from({ length: 36 }, (_, id) => id + 9));
    expect(state.translatedCount.value).toBe(45);
    expect(state.canApply.value).toBe(true);
  });

  it("最终响应覆盖流式预览，格式错误的行必须重新请求", async () => {
    const state = await setup();
    api.stream.mockImplementationOnce(async (_request, delta) => {
      delta(output + "\n");
      return result('{"id":0,"translation":"最终译文"}\n{"id":1,"translation":false}\n');
    });
    await state.start();
    expect(state.rows.value.map((row) => row.translation)).toEqual(["最终译文", ""]);
    api.stream.mockImplementationOnce(async (request) => {
      expect(JSON.parse(request.messages[1].content).lines.map(({ id }) => id)).toEqual([1]);
      return result('{"id":1,"translation":"补齐译文"}');
    });
    await state.resume();
    expect(state.canApply.value).toBe(true);
  });

  it.each(["length", "provider-error"])(
    "%s 时即使全部行已预览，仍需成功重试末行才允许应用",
    async (failure) => {
      const state = await setup();
      api.stream.mockImplementationOnce(async (_request, delta) => {
        delta(output + "\n");
        return failure === "provider-error"
          ? { status: "error", error: "connection lost" }
          : result(output, failure);
      });
      await state.start();
      expect(state.translatedCount.value).toBe(2);
      expect(state.canApply.value).toBe(false);
      expect(state.canResume.value).toBe(true);
      api.stream.mockImplementationOnce(async (request) => {
        expect(JSON.parse(request.messages[1].content).lines.map(({ id }) => id)).toEqual([1]);
        return result('{"id":1,"translation":"确认译文"}');
      });
      await state.resume();
      expect(state.canApply.value).toBe(true);
    },
  );

  it.each(["source", "language", "mode", "close", "unmount"])(
    "%s 变化立即阻止续译并清除进度",
    async (change) => {
      const state = await setup();
      api.stream.mockResolvedValueOnce(result('{"id":0,"translation":"已完成"}'));
      await state.start();
      expect(state.canResume.value).toBe(true);
      if (change === "source") media.lyricRevision++;
      else if (change === "language") state.targetLanguage.value = "ja";
      else if (change === "mode") state.mode.value = "aligned";
      else if (change === "close") state.open.value = false;
      else state.wrapper.unmount();
      await state.resume();
      await nextTick();
      expect(api.stream).toHaveBeenCalledOnce();
      expect(state.canResume.value).toBe(false);
      expect(state.translatedCount.value).toBe(0);
    },
  );

  it("主动重新翻译清空进度并重新请求所有行", async () => {
    const state = await setup();
    api.stream.mockResolvedValueOnce(result('{"id":0,"translation":"旧译文"}'));
    await state.start();
    api.stream.mockImplementationOnce(async (request) => {
      expect(state.translatedCount.value).toBe(0);
      expect(JSON.parse(request.messages[1].content).lines.map(({ id }) => id)).toEqual([0, 1]);
      return result(output);
    });
    await state.start();
    expect(state.canApply.value).toBe(true);
  });

  it("续译取消后保留已完成行，等待释放期间禁止重复续译并忽略旧回调", async () => {
    const state = await setup();
    api.stream.mockResolvedValueOnce(result('{"id":0,"translation":"保留译文"}'));
    await state.start();
    let resolve!: (value: AiRequestResult<AiCompletionResult>) => void;
    let lateDelta!: (text: string) => void;
    api.stream.mockImplementationOnce((_request, delta) => {
      lateDelta = delta;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const running = state.resume();
    await flushPromises();
    state.cancel();
    await state.resume();
    expect(state.canResume.value).toBe(false);
    expect(api.stream).toHaveBeenCalledTimes(2);
    expect(api.cancel).toHaveBeenCalledWith(api.stream.mock.calls[1][0].requestId);
    resolve({ status: "cancelled" });
    await running;
    expect(state.canResume.value).toBe(true);
    api.stream.mockImplementationOnce(async (request) => {
      lateDelta('{"id":0,"translation":"旧任务污染"}\n');
      expect(JSON.parse(request.messages[1].content).lines.map(({ id }) => id)).toEqual([1]);
      return result('{"id":1,"translation":"续译结果"}');
    });
    await state.resume();
    expect(state.rows.value.map((row) => row.translation)).toEqual(["保留译文", "续译结果"]);
    expect(state.canApply.value).toBe(true);
  });

  it("续译读取模型失败后仍可重试，并使用当前启用的模型", async () => {
    const state = await setup();
    api.stream.mockResolvedValueOnce(result('{"id":0,"translation":"保留译文"}'));
    await state.start();
    api.list.mockRejectedValueOnce(new Error("unavailable"));
    await state.resume();
    expect(state.error.value).toBe("player.aiTranslation.modelLoadFailed");
    expect(state.canResume.value).toBe(true);
    expect(state.translatedCount.value).toBe(1);
    expect(api.stream).toHaveBeenCalledOnce();
    api.list.mockResolvedValue({
      models: [{ ...active, id: "new-active", protocol: "anthropic" }],
      activeModelId: "new-active",
    });
    api.stream.mockImplementationOnce(async (request) => {
      expect(request.modelId).toBe("new-active");
      expect(JSON.parse(request.messages[1].content).lines.map(({ id }) => id)).toEqual([1]);
      return result('{"id":1,"translation":"续译结果"}');
    });
    await state.resume();
    expect(state.canApply.value).toBe(true);
  });

  it("多次续译不能绕过整首歌词的输出大小上限", async () => {
    media.parsedLyric = Array.from({ length: 100 }, () => media.parsedLyric[0]);
    const state = await setup();
    let requests = 0;
    api.stream.mockImplementation(async (request, delta) => {
      const ids = JSON.parse(request.messages[1].content).lines.map(({ id }) => id) as number[];
      const records = ids.map((id) => JSON.stringify({ id, translation: "译".repeat(14_000) }));
      if (++requests === 2) {
        delta(records[0] + "\n");
        return { status: "error", error: "connection lost" };
      }
      return result(records.join("\n"));
    });
    await state.start();
    expect(state.translatedCount.value).toBe(41);
    await state.resume();
    expect(state.phase.value).toBe("error");
    expect(state.translatedCount.value).toBe(74);
    await state.resume();
    expect(state.translatedCount.value).toBe(74);
    expect(state.canApply.value).toBe(false);
  });

  it("完整预览后同步关闭弹窗，watcher 执行前也不能应用", async () => {
    const state = await setup();
    api.stream.mockResolvedValue(result(output));
    await state.start();
    expect(state.canApply.value).toBe(true);
    state.open.value = false;
    expect(state.canApply.value).toBe(false);
    expect(state.apply()).toBe(false);
    expect(media.applyLyricTranslation).not.toHaveBeenCalled();
  });

  it("上一批的迟到增量不能破坏正在运行的新批次", async () => {
    media.parsedLyric = Array.from({ length: 41 }, () => media.parsedLyric[0]);
    const state = await setup();
    let lateDelta!: (text: string) => void;
    api.stream.mockImplementation(async (request, delta) => {
      const ids = JSON.parse(request.messages[1].content).lines.map(({ id }) => id) as number[];
      if (ids[0] === 0) lateDelta = delta;
      else lateDelta('{"id":99,"translation":"旧批次数据"}\n');
      return result(ids.map((id) => JSON.stringify({ id, translation: `译文${id}` })).join("\n"));
    });
    await state.start();
    expect(state.canApply.value).toBe(true);
    expect(state.translatedCount.value).toBe(41);
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it("逐字结果的总量包含行号和 JSON 封装，避免完成后应用入口再次拒绝", async () => {
    media.parsedLyric = Array.from({ length: 100 }, () => ({
      ...structuredClone(ALIGNMENT_LINES[0]),
      words: [structuredClone(ALIGNMENT_LINES[0].words[0])],
    }));
    const state = await setup();
    state.mode.value = "aligned";
    await nextTick();
    const value = {
      translation: [
        { text: "", from: 0, to: 0 },
        { text: "", from: 0, to: 0 },
      ],
      romanization: [{ index: 0, text: "kimi" }],
    };
    const textSize = Math.floor((1024 * 1024) / 100) - JSON.stringify(value).length;
    value.translation[0].text = "x".repeat(5000);
    value.translation[1].text = "x".repeat(textSize - 5000);
    api.stream.mockImplementation(async (request) => {
      const ids = JSON.parse(request.messages[1].content).lines.map(({ id }) => id) as number[];
      return result(ids.map((id) => JSON.stringify({ id, ...value })).join("\n"));
    });
    await state.start();
    expect(state.phase.value).toBe("error");
    expect(state.translatedCount.value).toBe(99);
    expect(state.canApply.value).toBe(false);
  });
});
