import type { Ref } from "vue";
import type { AiModelConfig } from "@shared/types/ai";
import { useMediaStore } from "@/stores/media";
import {
  GENERATION_TASKS,
  collectGenerationLines,
  createGenerationMessages,
  createGenerationPlan,
  GenerationDecoder,
  getGenerationCoverage,
  type GeneratedLyric,
  type GenerationOptions,
  type GenerationMode,
  type GenerationLine,
} from "@/services/lyric/aiGeneration";
import {
  MAX_BATCH_LINES,
  MAX_BATCH_CHARACTERS,
  type TranslationLanguage,
} from "@/services/lyric/aiTranslation";

/** 当前弹窗独占任务，仅为当前歌词和选择保留有界续译结果 */
export const useAiLyricTranslation = (open: Ref<boolean>) => {
  const media = useMediaStore();
  const { t } = useI18n();
  const targetLanguage = ref<TranslationLanguage>("zh-CN");
  const generationMode = ref<GenerationMode>("missing");
  const selected = ref<GenerationOptions>({
    translation: true,
    romanization: true,
    wordRomanization: true,
    wordTranslation: true,
  });
  const coverage = computed(() => getGenerationCoverage(media.parsedLyric));
  const planned = shallowRef<GenerationLine[]>([]);
  const plannedIds = computed(() => new Set(planned.value.map((line) => line.id)));
  const generationCount = computed(() => planned.value.length);
  const preservedCount = computed(() => rows.value.length - generationCount.value);
  const optionsKey = (options: GenerationOptions) =>
    GENERATION_TASKS.map((key) => (options[key] ? "1" : "0")).join("");
  const selectionKey = computed(() => `${generationMode.value}:${optionsKey(selected.value)}`);
  const hasSelection = computed(() => GENERATION_TASKS.some((key) => selected.value[key]));
  const model = shallowRef<AiModelConfig | null>(null);
  const loadingModel = ref(false);
  const rows = shallowRef<
    {
      id: number;
      text: string;
      translation: string;
      romanization: string;
      done: boolean;
    }[]
  >([]);
  const busy = ref(false);
  const phase = ref<"idle" | "running" | "completed" | "cancelled" | "error">("idle");
  const error = ref("");
  let modelVersion = 0;
  let disposed = false;
  let progress: {
    revision: number;
    language: TranslationLanguage;
    options: GenerationOptions;
    mode: GenerationMode;
    lines: GenerationLine[];
    key: string;
    results: Map<number, GeneratedLyric>;
    responseSize: number;
    responseSizes: Map<number, number>;
  } | null = null;
  let job: {
    revision: number;
    cancelled: boolean;
    invalid: boolean;
    requestId: string | null;
  } | null = null;

  const translatedCount = computed(
    () => rows.value.filter((row) => row.done && plannedIds.value.has(row.id)).length,
  );
  const canApply = computed(
    () =>
      !disposed &&
      open.value &&
      !media.lyricLoading &&
      phase.value === "completed" &&
      progress?.revision === media.lyricRevision &&
      progress.language === targetLanguage.value &&
      progress.key === selectionKey.value &&
      !busy.value,
  );
  const canStart = computed(
    () =>
      !!media.track &&
      !media.lyricLoading &&
      rows.value.length > 0 &&
      generationCount.value > 0 &&
      hasSelection.value &&
      !!model.value &&
      !loadingModel.value &&
      !busy.value,
  );
  const canResume = computed(
    () =>
      !disposed &&
      open.value &&
      !!media.track &&
      !media.lyricLoading &&
      !busy.value &&
      (phase.value === "error" || phase.value === "cancelled") &&
      progress?.revision === media.lyricRevision &&
      progress.language === targetLanguage.value &&
      progress.key === selectionKey.value &&
      translatedCount.value > 0,
  );

  const cancel = (): void => {
    if (!job || job.cancelled) return;
    job.cancelled = true;
    phase.value = "cancelled";
    if (job.requestId) void window.api.aiModel.cancel(job.requestId).catch(() => {});
  };

  const reset = (): void => {
    cancel();
    progress = null;
    phase.value = "idle";
    error.value = "";
    rows.value = [];
    planned.value = [];
    if (open.value && !media.lyricLoading) {
      try {
        planned.value = createGenerationPlan(
          media.parsedLyric,
          selected.value,
          generationMode.value,
        );
        rows.value = collectGenerationLines(media.parsedLyric).map((line) => ({
          id: line.id,
          text: line.text,
          translation: line.existingTranslation,
          romanization: line.existingRomanization,
          done: !plannedIds.value.has(line.id),
        }));
      } catch {
        error.value = t("player.aiTranslation.tooLarge");
      }
    }
  };

  const refreshModel = async (): Promise<void> => {
    const version = ++modelVersion;
    model.value = null;
    loadingModel.value = true;
    try {
      const state = await window.api.aiModel.list();
      if (disposed || !open.value || version !== modelVersion) return;
      model.value = state.models.find((item) => item.id === state.activeModelId) ?? null;
    } catch {
      if (!disposed && open.value && version === modelVersion)
        error.value = t("player.aiTranslation.modelLoadFailed");
    } finally {
      if (version === modelVersion) loadingModel.value = false;
    }
  };

  const run = async (resuming: boolean): Promise<void> => {
    if (
      disposed ||
      busy.value ||
      !open.value ||
      !media.track ||
      media.lyricLoading ||
      !hasSelection.value
    )
      return;
    if (resuming && !canResume.value) return;
    if (!resuming) {
      reset();
      progress = {
        revision: media.lyricRevision,
        language: targetLanguage.value,
        options: { ...selected.value },
        mode: generationMode.value,
        lines: planned.value,
        key: selectionKey.value,
        results: new Map(),
        responseSize: 0,
        responseSizes: new Map(),
      };
    }
    if (!rows.value.length || !progress || !progress.lines.length) return;
    const saved = progress;
    const source = collectGenerationLines(media.parsedLyric);
    const remaining = saved.lines.filter((line) => !saved.results.has(line.id));
    // 全部行已预览但请求未成功结束时，重试末行后才允许应用。
    if (!remaining.length) remaining.push(saved.lines.at(-1)!);
    remaining.sort((a, b) => optionsKey(a.options!).localeCompare(optionsKey(b.options!)));
    const song = {
      title: media.track.title,
      artists: media.track.artists.map((artist) => artist.name),
    };
    const current = {
      revision: saved.revision,
      cancelled: false,
      invalid: false,
      requestId: null as string | null,
    };
    job = current;
    busy.value = true;
    phase.value = "running";
    error.value = "";
    const isCurrent = () =>
      !disposed &&
      open.value &&
      job === current &&
      !current.cancelled &&
      progress === saved &&
      saved.language === targetLanguage.value &&
      saved.key === selectionKey.value &&
      current.revision === media.lyricRevision;
    const publish = (results: ReadonlyMap<number, GeneratedLyric>) => {
      try {
        for (const [id, value] of results) {
          const size = JSON.stringify({ id, ...value }).length + 1;
          const responseSize = saved.responseSize + size - (saved.responseSizes.get(id) ?? 0);
          if (responseSize > 1024 * 1024) throw new Error("整首辅助歌词超过大小限制");
          saved.responseSize = responseSize;
          saved.responseSizes.set(id, size);
          saved.results.set(id, value);
        }
      } finally {
        rows.value = source.map((line) => {
          const result = saved.results.get(line.id);
          return {
            id: line.id,
            text: line.text,
            translation:
              typeof result?.translation === "string"
                ? result.translation
                : (result?.translation?.map((part) => part.text).join("") ??
                  line.existingTranslation),
            romanization:
              typeof result?.romanization === "string"
                ? result.romanization
                : (result?.romanization?.map((part) => part.text).join(" ") ??
                  line.existingRomanization),
            done: !plannedIds.value.has(line.id) || !!result,
          };
        });
      }
    };
    try {
      await refreshModel();
      if (!isCurrent()) return;
      const active = model.value;
      if (!active) {
        phase.value = "error";
        if (!error.value) error.value = t("player.aiTranslation.noModel");
        return;
      }
      for (let offset = 0; offset < remaining.length;) {
        if (!isCurrent()) return;
        const options = remaining[offset].options!;
        const aligned = options.wordTranslation || options.wordRomanization;
        let end = offset,
          characters = 0,
          words = 0;
        // 字词映射和已有文本也计入批次预算，避免对齐请求超出模型输出上限。
        while (end < remaining.length && end - offset < (aligned ? 6 : MAX_BATCH_LINES)) {
          const line = remaining[end];
          if (optionsKey(line.options!) !== optionsKey(options)) break;
          const length =
            line.text.length +
            (options.wordTranslation && !options.translation
              ? line.existingTranslation.length
              : 0) +
            (options.wordRomanization && !options.romanization
              ? line.existingRomanization.length
              : 0);
          if (
            end > offset &&
            (characters + length > MAX_BATCH_CHARACTERS ||
              (aligned && words + line.words.length > 60))
          )
            break;
          characters += length;
          words += line.words.length;
          end++;
        }
        const batch = remaining.slice(offset, end);
        const decoder = new GenerationDecoder(batch, options);
        const requestId = crypto.randomUUID();
        current.requestId = requestId;
        let previousCount = 0;
        const result = await window.api.aiModel.stream(
          {
            requestId,
            modelId: active.id,
            messages: createGenerationMessages(batch, options, saved.language, song),
            maxTokens: 4096,
          },
          (text) => {
            if (!isCurrent() || current.requestId !== requestId || current.invalid) return;
            try {
              try {
                decoder.push(text);
              } finally {
                // 同一分片后半段损坏时保留前半段完整行，行内所有所选项目须一起有效。
                if (decoder.results.size !== previousCount) {
                  publish(decoder.results);
                  previousCount = decoder.results.size;
                }
              }
            } catch {
              current.invalid = true;
              error.value = t("player.aiTranslation.invalidOutput");
              phase.value = "error";
              void window.api.aiModel.cancel(requestId).catch(() => {});
            }
          },
        );
        current.requestId = null;
        if (!isCurrent() || current.invalid) return;
        if (result.status === "cancelled") {
          phase.value = "cancelled";
          return;
        }
        if (result.status === "error") {
          error.value = result.error;
          phase.value = "error";
          return;
        }
        // 隐藏窗口无增量时仍以最终结果恢复预览；失败尾记录不进入续译进度。
        const finalDecoder = new GenerationDecoder(batch, options);
        for (const { id } of batch) {
          saved.responseSize -= saved.responseSizes.get(id) ?? 0;
          saved.responseSizes.delete(id);
          saved.results.delete(id);
        }
        try {
          finalDecoder.push(result.data.text);
          finalDecoder.finish();
          if (["length", "max_tokens"].includes(result.data.finishReason ?? ""))
            throw new Error("truncated");
        } finally {
          publish(finalDecoder.results);
        }
        offset = end;
      }
      if (isCurrent()) phase.value = "completed";
    } catch {
      if (isCurrent()) {
        phase.value = "error";
        error.value = t("player.aiTranslation.invalidOutput");
      }
    } finally {
      if (job === current) {
        current.requestId = null;
        job = null;
        busy.value = false;
      }
    }
  };

  const start = (): Promise<void> => run(false);
  const resume = (): Promise<void> => run(true);
  const apply = (): boolean => {
    if (!canApply.value || !progress) return false;
    const saved = progress;
    return media.applyGeneratedLyric(
      saved.revision,
      saved.results,
      saved.options,
      saved.language,
      saved.mode,
    );
  };

  watch(
    open,
    (visible) => {
      if (visible) generationMode.value = "missing";
      reset();
      if (visible) {
        selected.value = Object.fromEntries(
          GENERATION_TASKS.map((key) => [key, coverage.value.existing[key] < coverage.value.total]),
        ) as GenerationOptions;
        void refreshModel();
      } else {
        modelVersion++;
        loadingModel.value = false;
        model.value = null;
      }
    },
    { immediate: true },
  );
  watch(
    () => media.lyricRevision,
    () => {
      const hadResult = busy.value || translatedCount.value > 0;
      generationMode.value = "missing";
      reset();
      selected.value = Object.fromEntries(
        GENERATION_TASKS.map((key) => [key, coverage.value.existing[key] < coverage.value.total]),
      ) as GenerationOptions;
      if (hadResult && open.value) error.value = t("player.aiTranslation.sourceChanged");
    },
  );
  watch(targetLanguage, reset);
  watch(selectionKey, reset, { flush: "sync" });
  onBeforeUnmount(() => {
    disposed = true;
    modelVersion++;
    cancel();
    progress = null;
    rows.value = [];
    planned.value = [];
  });

  return {
    targetLanguage,
    generationMode,
    selected,
    coverage,
    hasSelection,
    model,
    loadingModel,
    rows,
    busy,
    phase,
    error,
    translatedCount,
    generationCount,
    preservedCount,
    canApply,
    canStart,
    canResume,
    start,
    resume,
    cancel,
    apply,
  };
};
