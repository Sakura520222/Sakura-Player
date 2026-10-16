import type { Ref } from "vue";
import type { AiModelConfig } from "@shared/types/ai";
import { useMediaStore } from "@/stores/media";
import {
  AlignmentDecoder,
  collectAlignmentLines,
  createAlignmentMessages,
  type AlignedTranslation,
} from "@/services/lyric/aiAlignment";
import {
  collectTranslationLines,
  createTranslationMessages,
  TranslationDecoder,
  MAX_BATCH_LINES,
  MAX_BATCH_CHARACTERS,
  type TranslationLanguage,
  type TranslationLine,
} from "@/services/lyric/aiTranslation";

/** 当前弹窗独占翻译任务，不保留历史歌曲或模型响应缓存 */
export const useAiLyricTranslation = (open: Ref<boolean>) => {
  const media = useMediaStore();
  const { t } = useI18n();
  const targetLanguage = ref<TranslationLanguage>("zh-CN");
  const mode = ref<"aligned" | "line">("aligned");
  const model = shallowRef<AiModelConfig | null>(null);
  const loadingModel = ref(false);
  const rows = shallowRef<
    (TranslationLine & { romanization?: string; alignment?: AlignedTranslation })[]
  >([]);
  const busy = ref(false);
  const phase = ref<"idle" | "running" | "completed" | "cancelled" | "error">("idle");
  const error = ref("");
  let modelVersion = 0;
  let disposed = false;
  let progress: {
    revision: number;
    language: TranslationLanguage;
    mode: "aligned" | "line";
    translations: Map<number, string>;
    alignment: Map<number, AlignedTranslation> | null;
    responseSize: number;
    responseSizes: Map<number, number>;
  } | null = null;
  let job: {
    revision: number;
    cancelled: boolean;
    invalid: boolean;
    requestId: string | null;
  } | null = null;

  const translatedCount = computed(() => rows.value.filter((row) => row.translation).length);
  const canApply = computed(
    () =>
      !disposed &&
      open.value &&
      !media.lyricLoading &&
      phase.value === "completed" &&
      progress?.revision === media.lyricRevision &&
      progress.language === targetLanguage.value &&
      progress.mode === mode.value &&
      !busy.value,
  );
  const canStart = computed(
    () =>
      !!media.track &&
      !media.lyricLoading &&
      rows.value.length > 0 &&
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
      progress.mode === mode.value &&
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
    if (open.value && !media.lyricLoading) {
      try {
        rows.value = collectTranslationLines(media.parsedLyric);
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
    if (disposed || busy.value || !open.value || !media.track || media.lyricLoading) return;
    if (resuming && !canResume.value) return;
    if (!resuming) {
      reset();
      progress = {
        revision: media.lyricRevision,
        language: targetLanguage.value,
        mode: mode.value,
        translations: new Map(),
        alignment: mode.value === "aligned" ? new Map() : null,
        responseSize: 0,
        responseSizes: new Map(),
      };
    }
    if (!rows.value.length) return;
    const saved = progress;
    if (!saved) return;
    const source = rows.value;
    const aligned = saved.mode === "aligned";
    const remaining = source.filter((line) => !saved.translations.has(line.id));
    // 全部行已预览但请求未成功结束时，重试末行后才允许应用。
    if (!remaining.length) remaining.push(source.at(-1)!);
    const pendingIds = new Set(remaining.map((line) => line.id));
    const alignmentSource = aligned
      ? collectAlignmentLines(media.parsedLyric).filter((line) => pendingIds.has(line.id))
      : [];
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
      saved.mode === mode.value &&
      current.revision === media.lyricRevision;
    const publish = (translations: ReadonlyMap<number, string | AlignedTranslation>) => {
      try {
        for (const [id, value] of translations) {
          const size =
            JSON.stringify(
              typeof value === "string" ? { id, translation: value } : { id, ...value },
            ).length + 1;
          const previousSize = saved.responseSizes.get(id) ?? 0;
          const responseSize = saved.responseSize + size - previousSize;
          if (responseSize > 1024 * 1024) throw new Error("整首辅助歌词超过大小限制");
          saved.responseSize = responseSize;
          saved.responseSizes.set(id, size);
          if (typeof value === "string") saved.translations.set(id, value);
          else {
            saved.alignment!.set(id, value);
            saved.translations.set(id, value.translation.map((part) => part.text).join(""));
          }
        }
      } finally {
        rows.value = source.map((line) => ({
          ...line,
          translation: saved.translations.get(line.id) ?? "",
          alignment: saved.alignment?.get(line.id),
          romanization: saved.alignment
            ?.get(line.id)
            ?.romanization.map((word) => word.text)
            .join(" "),
        }));
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
      const language = saved.language;
      for (let offset = 0; offset < remaining.length;) {
        if (!isCurrent()) return;
        let end = offset;
        let characters = 0;
        let words = 0;
        // 字词映射的 JSON 开销更大，用较小批次兼容模型输出上限。
        while (end < remaining.length && end - offset < (aligned ? 6 : MAX_BATCH_LINES)) {
          const length = remaining[end].text.length;
          const wordCount = alignmentSource[end]?.words.length ?? 0;
          if (
            end > offset &&
            (characters + length > MAX_BATCH_CHARACTERS || (aligned && words + wordCount > 60))
          )
            break;
          characters += length;
          words += wordCount;
          end++;
        }
        const batch = remaining.slice(offset, end);
        const alignmentBatch = alignmentSource.slice(offset, end);
        const decoder = aligned
          ? new AlignmentDecoder(alignmentBatch)
          : new TranslationDecoder(batch);
        const requestId = crypto.randomUUID();
        current.requestId = requestId;
        let previousCount = 0;
        const result = await window.api.aiModel.stream(
          {
            requestId,
            modelId: active.id,
            messages: aligned
              ? createAlignmentMessages(alignmentBatch, language, song)
              : createTranslationMessages(batch, language, song),
            maxTokens: 4096,
          },
          (text) => {
            if (!isCurrent() || current.requestId !== requestId || current.invalid) return;
            try {
              try {
                decoder.push(text);
              } finally {
                // 同一分片后半段损坏时，前半段已校验的完整行仍可续译。
                if (decoder.translations.size !== previousCount) {
                  publish(decoder.translations);
                  previousCount = decoder.translations.size;
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
        // 隐藏窗口不会收到增量；最终完整结果也是对流式预览的校验。
        const finalDecoder = aligned
          ? new AlignmentDecoder(alignmentBatch)
          : new TranslationDecoder(batch);
        for (const { id } of batch) {
          saved.responseSize -= saved.responseSizes.get(id) ?? 0;
          saved.responseSizes.delete(id);
          saved.translations.delete(id);
          saved.alignment?.delete(id);
        }
        try {
          finalDecoder.push(result.data.text);
          finalDecoder.finish();
          if (["length", "max_tokens"].includes(result.data.finishReason ?? ""))
            throw new Error("truncated");
        } finally {
          publish(finalDecoder.translations);
        }
        offset = end;
      }
      if (!isCurrent()) return;
      phase.value = "completed";
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
    if (progress.alignment)
      return media.applyAlignedLyricTranslation(
        progress.revision,
        progress.alignment,
        progress.language,
      );
    return media.applyLyricTranslation(progress.revision, progress.translations, progress.language);
  };

  watch(
    open,
    (visible) => {
      reset();
      if (visible) void refreshModel();
      else {
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
      reset();
      if (hadResult && open.value) error.value = t("player.aiTranslation.sourceChanged");
    },
  );
  watch(targetLanguage, reset);
  watch(mode, reset);
  onBeforeUnmount(() => {
    disposed = true;
    modelVersion++;
    cancel();
    progress = null;
    rows.value = [];
  });

  return {
    targetLanguage,
    mode,
    model,
    loadingModel,
    rows,
    busy,
    phase,
    error,
    translatedCount,
    canApply,
    canStart,
    canResume,
    start,
    resume,
    cancel,
    apply,
  };
};
