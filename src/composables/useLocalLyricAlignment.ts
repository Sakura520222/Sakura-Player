import type { Ref } from "vue";
import type { AlignmentLanguage } from "@shared/types/lyricAlignment";
import {
  collectPrimaryAlignmentLines,
  applyPrimaryAlignment,
} from "@/services/lyric/primaryAlignment";
import type { AlignmentLineResult } from "@shared/types/lyricAlignment";
import { useMediaStore } from "@/stores/media";
import { applyLocalAlignment, collectLocalAlignmentLines } from "@/services/lyric/localAlignment";
import { useLyricAlignmentEnvironment } from "./useLyricAlignmentEnvironment";

/**
 * 管理本地对齐预览，关闭、切歌、换源或修改选项都会使旧结果失效
 * @param open - 对齐弹窗是否打开
 * @returns 选择、预览、取消和应用操作
 */
export const useLocalLyricAlignment = (open: Ref<boolean>) => {
  const media = useMediaStore();
  const { t } = useI18n();
  const translation = ref(true);
  const romanization = ref(true);
  const primary = ref(false);
  const language = ref<AlignmentLanguage>("zh");
  const realignExisting = ref(false);
  const environment = useLyricAlignmentEnvironment(open);
  const acousticEnvironment = useLyricAlignmentEnvironment(open, "acoustic");
  const busy = ref(false);
  const completed = ref(false);
  const error = ref("");
  const translationError = ref("");
  const results = shallowRef<AlignmentLineResult[]>([]);
  const rejected = shallowRef<AlignmentLineResult[]>([]);
  const selected = shallowRef(new Set<number>());
  let job: { id: string; revision: number; cancelled: boolean } | null = null;
  let resultRevision = -1;
  const source = computed(() => {
    try {
      const lyrics = primary.value ? media.getLyricExportLines() : media.parsedLyric;
      const primaryLines = primary.value
        ? collectPrimaryAlignmentLines(lyrics).filter(
            (line) => !media.aiLyricExcludedIds.has(line.id),
          )
        : [];
      const allLines = primary.value ? primaryLines : collectLocalAlignmentLines(lyrics, true);
      return {
        allLines,
        lines:
          primary.value || realignExisting.value ? allLines : collectLocalAlignmentLines(lyrics),
        error: "",
      };
    } catch {
      return { allLines: [], lines: [], error: t("player.localAlignment.tooLarge") };
    }
  });
  const fields = computed(() =>
    (["translation", "romanization"] as const).filter((field) =>
      field === "translation" ? translation.value : romanization.value,
    ),
  );
  const requestedLines = computed(() =>
    source.value.lines.filter(
      (line) =>
        (primary.value && line.primary) ||
        (translation.value && line.translation.trim()) ||
        (romanization.value && line.romanization.trim()),
    ),
  );
  const rows = computed(() => {
    const resolved = new Map([...rejected.value, ...results.value].map((line) => [line.id, line]));
    const original = new Map(source.value.allLines.map((line) => [line.id, line]));
    return requestedLines.value.map((line) => ({
      ...line,
      original: original.get(line.id)!,
      text: line.words.join(""),
      result: resolved.get(line.id),
    }));
  });
  const coverage = computed(() =>
    fields.value.map((field) => {
      const total = requestedLines.value.filter((line) => line[field].trim()).length;
      const existing = source.value.allLines.filter((line) => line[field].trim()).length - total;
      return {
        field,
        total,
        existing,
        matched: results.value.filter((line) => line[field]).length,
      };
    }),
  );
  const canStart = computed(
    () =>
      open.value &&
      !busy.value &&
      !media.lyricLoading &&
      !!media.track &&
      (!primary.value || acousticEnvironment.ready.value) &&
      (primary.value ||
        !translation.value ||
        !requestedLines.value.some((line) => line.translation.trim()) ||
        environment.ready.value) &&
      requestedLines.value.length > 0,
  );
  const canApply = computed(
    () =>
      open.value &&
      !busy.value &&
      !media.lyricLoading &&
      completed.value &&
      resultRevision === media.lyricRevision &&
      selected.value.size > 0,
  );

  /** 取消计算并立即禁止应用迟到的返回值 */
  const cancel = (): void => {
    if (!job || job.cancelled) return;
    job.cancelled = true;
    void window.api.lyricAlignment.cancel(job.id).catch(() => {});
  };

  /** 清除预览并取消已失效任务 */
  const reset = (): void => {
    cancel();
    completed.value = false;
    results.value = [];
    rejected.value = [];
    selected.value = new Set();
    error.value = "";
    translationError.value = "";
    resultRevision = -1;
  };

  /** 一次处理整曲快照，主歌词在内部按传输大小分批，低分结果保留警告 */
  const start = async (): Promise<void> => {
    if (!canStart.value) return;
    reset();
    const current = { id: crypto.randomUUID(), revision: media.lyricRevision, cancelled: false };
    job = current;
    busy.value = true;
    const lyrics = primary.value ? media.getLyricExportLines() : media.parsedLyric;
    try {
      const inputLines = requestedLines.value.map((line) => ({
        ...line,
        translation: translation.value ? line.translation : "",
        romanization: romanization.value ? line.romanization : "",
      }));
      const batches: (typeof inputLines)[] = [[]];
      let characters = 0;
      for (const line of inputLines) {
        const size =
          line.words.join("").length +
          (line.readings?.join("").length ?? 0) +
          line.translation.length +
          line.romanization.length;
        if (
          primary.value &&
          batches.at(-1)!.length &&
          (characters + size > 8000 || batches.at(-1)!.length >= 1000)
        ) {
          batches.push([]);
          characters = 0;
        }
        batches.at(-1)!.push(line);
        characters += size;
      }
      const response: { lines: AlignmentLineResult[]; translationError?: string } = { lines: [] };
      for (const lines of batches) {
        if (current.cancelled || current.revision !== media.lyricRevision || !open.value) return;
        const batch = await window.api.lyricAlignment.align({
          requestId: current.id,
          lines,
          translation: translation.value,
          romanization: romanization.value,
          ...(primary.value
            ? { primary: { trackId: media.track!.id, language: language.value } }
            : {}),
        });
        if (
          current.cancelled ||
          current.revision !== media.lyricRevision ||
          !open.value ||
          job !== current
        )
          return;
        if (batch.status === "cancelled") return;
        if (batch.status === "error") {
          error.value = batch.error;
          return;
        }
        response.lines.push(...batch.lines);
        if (batch.translationError) response.translationError = batch.translationError;
      }
      if (
        job !== current ||
        current.cancelled ||
        !open.value ||
        current.revision !== media.lyricRevision
      )
        return;
      const accepted: AlignmentLineResult[] = [];
      const ids = new Set<number>();
      for (const line of response.lines) {
        const original = lyrics[line.id];
        if (!original || ids.has(line.id))
          throw new Error(t("player.localAlignment.invalidResult"));
        ids.add(line.id);
        const result: AlignmentLineResult = { id: line.id };
        const aligned =
          primary.value && line.primary ? applyPrimaryAlignment(original, line.primary) : null;
        if (aligned && line.primary) result.primary = line.primary;
        for (const field of ["translation", "romanization"] as const) {
          if (
            line[field] &&
            (field === "translation" ? translation.value : romanization.value) &&
            applyLocalAlignment(
              [aligned ?? original],
              [{ id: 0, [field]: line[field] }],
              realignExisting.value,
            )
          )
            result[field] = line[field];
        }
        if (result.primary || result.translation || result.romanization) accepted.push(result);
        else if (line.reason)
          rejected.value = [...rejected.value, { id: line.id, reason: line.reason }];
      }
      results.value = accepted;
      selected.value = new Set(accepted.map((line) => line.id));
      resultRevision = current.revision;
      translationError.value = response.translationError ?? "";
      completed.value = true;
    } catch (failure) {
      if (!current.cancelled && open.value && current.revision === media.lyricRevision)
        error.value = failure instanceof Error ? failure.message : String(failure);
    } finally {
      if (job === current) {
        job = null;
        busy.value = false;
      }
    }
  };

  /**
   * 选择预览中需要应用的行
   * @param id - 稳定歌词行号
   * @param checked - 是否应用本行
   */
  const select = (id: number, checked: boolean): void => {
    const next = new Set(selected.value);
    if (checked && results.value.some((line) => line.id === id)) next.add(id);
    else next.delete(id);
    selected.value = next;
  };

  /**
   * 原子应用选中的候选，未选择的行继续使用原有文本
   * @returns 成功应用的行数和轨道种类；过期结果返回 null
   */
  const apply = (): { count: number; translation: boolean; romanization: boolean } | null => {
    if (!canApply.value) return null;
    const chosen = results.value.filter((line) => selected.value.has(line.id));
    const tracks = {
      count: chosen.length,
      translation: chosen.some((line) => line.translation),
      romanization: chosen.some((line) => line.romanization),
    };
    if (!media.applyLocalLyricAlignment(resultRevision, chosen, realignExisting.value)) return null;
    reset();
    return tracks;
  };

  watch(
    [
      open,
      () => media.lyricRevision,
      () => media.lyricLoading,
      translation,
      romanization,
      realignExisting,
      primary,
      language,
    ],
    ([visible], [wasVisible]) => {
      if (!visible && wasVisible) cancel();
      else reset();
    },
    { flush: "sync" },
  );
  onBeforeUnmount(reset);
  return {
    translation,
    romanization,
    primary,
    language,
    acousticEnvironment,
    realignExisting,
    environment,
    busy,
    completed,
    error,
    translationError,
    source,
    rows,
    coverage,
    fields,
    results,
    selected,
    canStart,
    canApply,
    start,
    cancel,
    select,
    apply,
  };
};
