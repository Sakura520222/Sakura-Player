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

let media: {
  track: Track | null;
  parsedLyric: LyricLine[];
  lyricRevision: number;
  lyricLoading: boolean;
  applyLyricTranslation: ReturnType<typeof vi.fn>;
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
});
