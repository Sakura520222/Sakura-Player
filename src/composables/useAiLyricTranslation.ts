import type { Ref } from "vue";
import type { AiModelConfig } from "@shared/types/ai";
import { useMediaStore } from "@/stores/media";
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
  const model = shallowRef<AiModelConfig | null>(null);
  const loadingModel = ref(false);
  const rows = shallowRef<TranslationLine[]>([]);
  const busy = ref(false);
  const phase = ref<"idle" | "running" | "completed" | "cancelled" | "error">("idle");
  const error = ref("");
  let modelVersion = 0;
  let disposed = false;
  let completed: {
    revision: number;
    language: TranslationLanguage;
    translations: Map<number, string>;
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
      phase.value === "completed" &&
      completed?.revision === media.lyricRevision &&
      completed.language === targetLanguage.value &&
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

  const cancel = (): void => {
    if (!job || job.cancelled) return;
    job.cancelled = true;
    phase.value = "cancelled";
    if (job.requestId) void window.api.aiModel.cancel(job.requestId).catch(() => {});
  };

  const reset = (): void => {
    cancel();
    completed = null;
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

  const start = async (): Promise<void> => {
    if (busy.value || !open.value || !media.track || media.lyricLoading) return;
    reset();
    if (!rows.value.length) return;
    const source = rows.value;
    const song = {
      title: media.track.title,
      artists: media.track.artists.map((artist) => artist.name),
    };
    const current = {
      revision: media.lyricRevision,
      cancelled: false,
      invalid: false,
      requestId: null as string | null,
    };
    job = current;
    busy.value = true;
    phase.value = "running";
    const received = new Map<number, string>();
    const isCurrent = () =>
      !disposed &&
      open.value &&
      job === current &&
      !current.cancelled &&
      current.revision === media.lyricRevision;
    const publish = (translations: Map<number, string>) => {
      for (const [id, text] of translations) received.set(id, text);
      rows.value = source.map((line) => ({ ...line, translation: received.get(line.id) ?? "" }));
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
      const language = targetLanguage.value;
      for (let offset = 0; offset < source.length;) {
        if (!isCurrent()) return;
        let end = offset;
        let characters = 0;
        while (end < source.length && end - offset < MAX_BATCH_LINES) {
          const length = source[end].text.length;
          if (end > offset && characters + length > MAX_BATCH_CHARACTERS) break;
          characters += length;
          end++;
        }
        const batch = source.slice(offset, end);
        const decoder = new TranslationDecoder(batch);
        const requestId = crypto.randomUUID();
        current.requestId = requestId;
        let previousCount = 0;
        const result = await window.api.aiModel.stream(
          {
            requestId,
            modelId: active.id,
            messages: createTranslationMessages(batch, language, song),
            maxTokens: 4096,
          },
          (text) => {
            if (!isCurrent() || current.invalid) return;
            try {
              decoder.push(text);
              if (decoder.translations.size !== previousCount) {
                previousCount = decoder.translations.size;
                publish(decoder.translations);
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
        if (["length", "max_tokens"].includes(result.data.finishReason ?? ""))
          throw new Error("truncated");
        // 隐藏窗口不会收到增量；最终完整结果也是对流式预览的校验。
        const finalDecoder = new TranslationDecoder(batch);
        finalDecoder.push(result.data.text);
        publish(finalDecoder.finish());
        offset = end;
      }
      if (!isCurrent()) return;
      completed = { revision: current.revision, language, translations: received };
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

  const apply = (): boolean => {
    if (!canApply.value || !completed) return false;
    return media.applyLyricTranslation(
      completed.revision,
      completed.translations,
      completed.language,
    );
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
      const hadResult = busy.value || phase.value === "completed";
      reset();
      if (hadResult && open.value) error.value = t("player.aiTranslation.sourceChanged");
    },
  );
  watch(targetLanguage, reset);
  onBeforeUnmount(() => {
    disposed = true;
    modelVersion++;
    cancel();
    completed = null;
    rows.value = [];
  });

  return {
    targetLanguage,
    model,
    loadingModel,
    rows,
    busy,
    phase,
    error,
    translatedCount,
    canApply,
    canStart,
    start,
    cancel,
    apply,
  };
};
