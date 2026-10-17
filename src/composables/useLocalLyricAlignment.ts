import type { Ref } from "vue";
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
  const realignExisting = ref(false);
  const environment = useLyricAlignmentEnvironment(open);
  const busy = ref(false);
  const completed = ref(false);
  const error = ref("");
  const translationError = ref("");
  const results = shallowRef<AlignmentLineResult[]>([]);
  const selected = shallowRef(new Set<number>());
  let job: { id: string; revision: number; cancelled: boolean } | null = null;
  let resultRevision = -1;
  const source = computed(() => {
    try {
      const allLines = collectLocalAlignmentLines(media.parsedLyric, true);
      return {
        allLines,
        lines: realignExisting.value ? allLines : collectLocalAlignmentLines(media.parsedLyric),
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
        (translation.value && line.translation.trim()) ||
        (romanization.value && line.romanization.trim()),
    ),
  );
  const rows = computed(() => {
    const resolved = new Map(results.value.map((line) => [line.id, line]));
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
      (!translation.value ||
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
    selected.value = new Set();
    error.value = "";
    translationError.value = "";
    resultRevision = -1;
  };

  /** 运行当前快照并逐轨校验，低分或不完整的行只保留原文 */
  const start = async (): Promise<void> => {
    if (!canStart.value) return;
    reset();
    const current = { id: crypto.randomUUID(), revision: media.lyricRevision, cancelled: false };
    job = current;
    busy.value = true;
    try {
      const response = await window.api.lyricAlignment.align({
        requestId: current.id,
        lines: requestedLines.value.map((line) => ({
          ...line,
          translation: translation.value ? line.translation : "",
          romanization: romanization.value ? line.romanization : "",
        })),
        translation: translation.value,
        romanization: romanization.value,
      });
      if (
        job !== current ||
        current.cancelled ||
        !open.value ||
        current.revision !== media.lyricRevision
      )
        return;
      if (response.status === "cancelled") return;
      if (response.status === "error") {
        error.value = response.error;
        return;
      }
      const accepted: AlignmentLineResult[] = [];
      const ids = new Set<number>();
      for (const line of response.lines) {
        const original = media.parsedLyric[line.id];
        if (!original || ids.has(line.id))
          throw new Error(t("player.localAlignment.invalidResult"));
        ids.add(line.id);
        const result: AlignmentLineResult = { id: line.id };
        for (const field of ["translation", "romanization"] as const) {
          if (
            line[field] &&
            (field === "translation" ? translation.value : romanization.value) &&
            applyLocalAlignment(
              [original],
              [{ id: 0, [field]: line[field] }],
              realignExisting.value,
            )
          )
            result[field] = line[field];
        }
        if (result.translation || result.romanization) accepted.push(result);
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
    ],
    reset,
    { flush: "sync" },
  );
  onBeforeUnmount(reset);
  return {
    translation,
    romanization,
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
