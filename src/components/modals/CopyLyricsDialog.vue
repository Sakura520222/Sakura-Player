<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import { saveTrackTags } from "@/core/player";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import { createLyricPoster } from "@/utils/lyric/poster";
import { createLyricSaveContent, getLyricExportMetadata } from "@/utils/lyric/save";
import { serializeCompatibleLyrics } from "@shared/utils/lyricCompatible";
import {
  LYRIC_COMPATIBLE_FORMATS,
  type CompatibleLyricFormat,
  type LyricSaveFilesRequest,
} from "@shared/types/lyrics";
import type { LyricSavePreviewTarget } from "@/types/lyric-preview";

const LyricSavePreviewDialog = defineAsyncComponent(() => import("./LyricSavePreviewDialog.vue"));

const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const media = useMediaStore();
const theme = useThemeStore();
const settings = useSettingsStore();
const { copy } = useCopyText();

/** 复制内容过滤项 */
type CopyFilter = "translation" | "romaji" | "emptyLine" | "songName" | "artist";

/** 选中的过滤项（默认开启翻译/音译/歌名/歌手，空行默认关闭） */
const selectedFilters = ref<CopyFilter[]>(["translation", "romaji", "songName", "artist"]);

/** 选中的歌词行索引 */
const selectedLines = ref<number[]>([]);

/** 展示用歌词行 */
const displayLyrics = computed(() =>
  media.parsedLyric
    .filter((line) => !line.isBG)
    .map((line, index) => ({
      index,
      language: line.language,
      text: line.words.map((word) => word.word).join(""),
      translation: line.translatedLyric || "",
      romaji: line.romanLyric || line.words.map((word) => word.romanWord ?? "").join(""),
      duet: line.isDuet,
    })),
);

const showTranslation = computed(() => selectedFilters.value.includes("translation"));
const showRomaji = computed(() => selectedFilters.value.includes("romaji"));

/** 歌名 / 歌手后缀 */
const suffix = computed(() => {
  const withSongName = selectedFilters.value.includes("songName");
  const withArtist = selectedFilters.value.includes("artist");
  const track = media.track;
  if ((!withSongName && !withArtist) || !track) return "";
  const songName = track.title;
  const artistName = track.artists.map((artist) => artist.name).join(" / ");
  if (withSongName && withArtist) return `——《${songName}》 - ${artistName}`;
  if (withSongName) return `——《${songName}》`;
  return `—— ${artistName}`;
});

/** 已选行集合，加速勾选判断 */
const pickedSet = computed(() => new Set(selectedLines.value));

const isAllSelected = computed(
  () => displayLyrics.value.length > 0 && selectedLines.value.length === displayLyrics.value.length,
);

/** 打开时默认全选 */
watch(
  () => props.open,
  (open) => {
    if (open) selectedLines.value = displayLyrics.value.map((line) => line.index);
  },
);

/** 勾选 / 取消某一行 */
const toggleLine = (index: number, checked: boolean): void => {
  if (!checked) {
    selectedLines.value = selectedLines.value.filter((item) => item !== index);
  } else if (!selectedLines.value.includes(index)) {
    selectedLines.value = [...selectedLines.value, index];
  }
};

const toggleSelectAll = (): void => {
  selectedLines.value = isAllSelected.value ? [] : displayLyrics.value.map((line) => line.index);
};

/** 反选 */
const invertSelection = (): void => {
  const picked = pickedSet.value;
  selectedLines.value = displayLyrics.value
    .map((line) => line.index)
    .filter((index) => !picked.has(index));
};

/** 复制歌词 */
const handleCopy = async (): Promise<void> => {
  const separator = selectedFilters.value.includes("emptyLine") ? "\n\n" : "\n";
  let content = displayLyrics.value
    .filter((line) => pickedSet.value.has(line.index))
    .map((line) => {
      const parts = [line.text];
      if (showTranslation.value && line.translation) parts.push(line.translation);
      if (showRomaji.value && line.romaji) parts.push(line.romaji);
      return parts.filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join(separator);
  if (suffix.value) content += `${separator}${suffix.value}`;
  if (!content) {
    toast.warning(t("player.copyLyric.empty"));
    return;
  }
  await copy(content);
};

/** 复制歌词原文 */
const handleCopyRaw = async (): Promise<void> => {
  const content = media.lyricContent?.content;
  if (content) await copy(content);
};

/** 导出中，防重复点击 */
const exporting = ref(false);
const saving = ref(false);
const saveMetadata = ref(false);
const saveLrc = ref(false);
const saveTtml = ref(true);
const compatibleFormat = ref<CompatibleLyricFormat>("lrc");
const formatOptions = LYRIC_COMPATIBLE_FORMATS.map((value) => ({
  value,
  label: value === "enhanced-lrc" ? "Enhanced LRC (A2)" : value.toUpperCase(),
}));
const saveFeedback = ref<string[]>([]);
const previewing = ref(false);
const previewOpen = ref(false);
const previewTargets = shallowRef<LyricSavePreviewTarget[]>([]);
let previewRequestId = 0;
const canWriteMetadata = computed(
  () => media.track?.source === "local" && !!media.track.path && !media.track.cuePath,
);
const hasTtmlRepo = computed(
  () => settings.system.localLyric.enableLocalTTMLOverride && !!settings.system.localLyric.repoDir,
);
const hasTranslation = computed(() => media.parsedLyric.some((line) => line.translatedLyric));
const hasRomanization = computed(() =>
  media.parsedLyric.some((line) => line.romanLyric || line.words.some((word) => word.romanWord)),
);

const saveSnapshot = computed(() => {
  const track = media.track;
  const input = media.lyricContent;
  const format = media.lyricFormat;
  if (!track || !input?.content || !format || media.lyricLoading || !media.parsedLyric.length)
    return null;
  return {
    track: toRaw(track),
    input: { ...toRaw(input), format },
    lines: media.getLyricExportLines(),
    writeMetadata: canWriteMetadata.value && saveMetadata.value,
    writeLrc: saveLrc.value,
    writeTtml: saveTtml.value,
    saveTtmlAs: !hasTtmlRepo.value,
    compatibleFormat: compatibleFormat.value,
  };
});

const canSaveLyrics = computed(() => {
  const snapshot = saveSnapshot.value;
  return !!snapshot && (snapshot.writeMetadata || snapshot.writeLrc || snapshot.writeTtml);
});

watch(
  [() => props.open, saveSnapshot, () => settings.system.localLyric.repoDir],
  () => {
    previewRequestId++;
    previewing.value = false;
    previewOpen.value = false;
    previewTargets.value = [];
  },
  { flush: "sync" },
);
watch(previewOpen, (open) => {
  if (!open) previewTargets.value = [];
});
onBeforeUnmount(() => {
  previewRequestId++;
});

/**
 * 为每个导出目标生成独立的预览及待写入数据
 * @param snapshot - 不随切歌变化的歌词快照
 * @returns 完整 TTML、兼容文件与可显示的错误
 */
const prepareSave = (snapshot: NonNullable<typeof saveSnapshot.value>) => {
  const { track, input, lines, writeMetadata, writeTtml, writeLrc, saveTtmlAs, compatibleFormat } =
    snapshot;
  const request: LyricSaveFilesRequest = { track, saveTtmlAs };
  const errors: LyricSavePreviewTarget[] = [];
  let full: ReturnType<typeof createLyricSaveContent> | undefined;
  if (writeMetadata || writeTtml) {
    try {
      full = createLyricSaveContent(track, lines, input);
      if (writeTtml) Object.assign(request, full);
    } catch (error) {
      for (const key of ["ttml", "metadata"] as const) {
        if (key === "ttml" ? writeTtml : writeMetadata)
          errors.push({
            key,
            fields: [],
            error: error instanceof Error ? error.message : String(error),
          });
      }
    }
  }
  if (writeLrc) {
    try {
      Object.assign(request, {
        compatibleFormat,
        ...serializeCompatibleLyrics(lines, compatibleFormat, getLyricExportMetadata(track, input)),
      });
    } catch (error) {
      errors.push({
        key: "lrc",
        label: compatibleFormat.toUpperCase(),
        fields: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { full, request, errors };
};

/** 按保存快照读取原歌词，过期的请求不会重新打开预览 */
const handlePreviewLyrics = async (): Promise<void> => {
  const snapshot = saveSnapshot.value;
  if (!snapshot || saving.value || previewing.value || !canSaveLyrics.value) return;
  const id = ++previewRequestId;
  previewing.value = true;
  try {
    const { full, request, errors } = prepareSave(snapshot);
    const targets = [...errors];
    if (snapshot.writeMetadata && full) {
      try {
        const result = await window.api.library.readTags(snapshot.track.path!);
        if (!result.success || !result.data)
          throw new Error(t("player.copyLyric.preview.readFailed"));
        targets.push({
          key: "metadata",
          path: snapshot.track.path,
          exists: !!result.data.lyrics,
          fields: [
            {
              key: "lyrics",
              before: result.data.lyrics ?? "",
              after: full.ttml,
              beforeFormat: result.data.lyricData?.format,
              afterFormat: "ttml",
            },
          ],
        });
      } catch (error) {
        targets.push({
          key: "metadata",
          fields: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (request.lrc !== undefined || request.ttml !== undefined) {
      const result = await window.api.lyrics.previewFiles(request);
      for (const key of ["lrc", "ttml", "translation", "romanization"] as const) {
        if (request[key] === undefined) continue;
        const before = result[key];
        const label = key === "lrc" ? snapshot.compatibleFormat.toUpperCase() : undefined;
        if (!before || before.status === "failed") {
          targets.push({
            key,
            label,
            fields: [],
            error: before?.error ?? t("player.copyLyric.preview.readFailed"),
          });
        } else {
          targets.push({
            key,
            label,
            path: before.path,
            exists: before.exists,
            needsDestination: before.needsDestination,
            fields: [{ key: "lyrics", before: before.content, after: request[key] }],
          });
        }
      }
    }
    if (id !== previewRequestId) return;
    previewTargets.value = targets;
    previewOpen.value = true;
  } catch (error) {
    if (id === previewRequestId)
      toast.error(
        error instanceof Error ? error.message : t("player.copyLyric.preview.readFailed"),
      );
  } finally {
    if (id === previewRequestId) previewing.value = false;
  }
};

watch(
  () => media.track?.id,
  () => {
    saveFeedback.value = [];
  },
);

/** 保存前固定歌曲与歌词快照，重载歌曲时不会混入新歌词 */
const handleSaveLyrics = async (): Promise<void> => {
  const snapshot = saveSnapshot.value;
  if (saving.value || previewing.value || !snapshot || !canSaveLyrics.value) return;
  saving.value = true;
  saveFeedback.value = [];
  const saved: string[] = [];
  const failed: string[] = [];
  try {
    const { full, request, errors } = prepareSave(snapshot);
    for (const error of errors) failed.push(error.error ?? t("player.copyLyric.saveFailed"));
    if (request.lrc !== undefined || request.ttml !== undefined) {
      try {
        const result = await window.api.lyrics.saveFiles(request);
        for (const [target, outcome] of Object.entries(result)) {
          const label =
            target === "lrc"
              ? snapshot.compatibleFormat.toUpperCase()
              : t(`player.copyLyric.preview.targets.${target}`);
          if (outcome.status === "saved") {
            saved.push(label);
            saveFeedback.value.push(`${label} · ${outcome.path}`);
          } else if (outcome.status === "failed") {
            failed.push(`${label} · ${outcome.error}`);
          }
        }
      } catch {
        failed.push(t("player.copyLyric.saveFilesFailed"));
      }
    }
    if (snapshot.writeMetadata && full) {
      try {
        const outcomes = await saveTrackTags([
          {
            path: snapshot.track.path!,
            lyrics: full.ttml,
            lyricData: { format: "ttml", auxiliary: full.auxiliary },
          },
        ]);
        const outcome = outcomes?.[0];
        if (outcome?.success) saved.push(t("player.copyLyric.musicTags"));
        else failed.push(outcome?.error ?? t("player.copyLyric.saveFailed"));
      } catch {
        failed.push(t("player.copyLyric.saveFailed"));
      }
    }
    if (saved.length)
      toast.success(t("player.copyLyric.saveSuccess", { targets: saved.join(" / ") }));
    if (failed.length) {
      saveFeedback.value.push(...failed);
      toast.error(failed.join("\n"));
    }
  } finally {
    saving.value = false;
  }
};

/** 导出歌词图片 */
const handleExport = async (): Promise<void> => {
  const track = media.track;
  if (exporting.value || !track || !selectedLines.value.length) return;
  exporting.value = true;
  try {
    const blob = await createLyricPoster({
      track,
      lines: displayLyrics.value
        .filter((line) => pickedSet.value.has(line.index))
        .map((line) => ({
          text: line.text,
          language: line.language,
          translation: showTranslation.value && line.translation ? line.translation : undefined,
          romaji: showRomaji.value && line.romaji ? line.romaji : undefined,
          duet: line.duet,
        })),
      fallbackColor: theme.coverColor,
      fonts: {
        global: settings.appearance.fontFamily,
        lyric: settings.lyric.fontFamily,
        chinese: settings.lyric.fontFamilyChinese,
        japanese: settings.lyric.fontFamilyJapanese,
        korean: settings.lyric.fontFamilyKorean,
        latin: settings.lyric.fontFamilyLatin,
      },
    });
    const artist = track.artists.map((item) => item.name).join(", ");
    const suffixName = t("player.copyLyric.fileSuffix");
    const fileName = `${track.title} - ${artist} - ${suffixName}.png`.replace(/[\\/:*?"<>|]/g, " ");
    const res = await window.api.system.saveFile(
      await blob.arrayBuffer(),
      fileName,
      t("player.copyLyric.saveDialogTitle"),
    );
    if (res.success) toast.success(t("player.copyLyric.saved"));
    else if (!res.canceled) toast.error(t("player.copyLyric.exportFailed"));
  } catch {
    toast.error(t("player.copyLyric.exportFailed"));
  } finally {
    exporting.value = false;
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('player.copyLyric.title')"
    width="540px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <!-- 歌词列表 -->
      <div class="max-h-[36vh] overflow-y-auto flex flex-col">
        <SCheckbox
          v-for="line in displayLyrics"
          :key="line.index"
          :checked="pickedSet.has(line.index)"
          class="w-full! px-2 py-1.5 rounded-md hover:bg-on-surface/5"
          @update:checked="toggleLine(line.index, $event)"
        >
          <div class="flex flex-col gap-0.5 leading-snug">
            <span v-if="line.text" class="text-sm text-on-surface">{{ line.text }}</span>
            <span v-if="showTranslation && line.translation" class="text-xs text-on-surface/60">
              {{ line.translation }}
            </span>
            <span v-if="showRomaji && line.romaji" class="text-xs italic text-on-surface/45">
              {{ line.romaji }}
            </span>
          </div>
        </SCheckbox>
      </div>
      <!-- 复制内容选项 -->
      <div class="flex flex-col gap-2 border-t border-outline-variant/30 pt-3">
        <span v-if="suffix" class="text-right text-xs text-on-surface/50 truncate">
          {{ suffix }}
        </span>
        <span class="text-xs text-on-surface/50">{{ t("player.copyLyric.contentLabel") }}</span>
        <div class="flex items-center gap-2">
          <SCheckboxGroup v-model:value="selectedFilters" size="small">
            <SCheckbox value="translation" :label="t('player.copyLyric.translation')" />
            <SCheckbox value="romaji" :label="t('player.copyLyric.romaji')" />
            <SCheckbox value="emptyLine" :label="t('player.copyLyric.emptyLine')" />
            <SCheckbox value="songName" :label="t('player.copyLyric.songName')" />
            <SCheckbox value="artist" :label="t('player.copyLyric.artist')" />
          </SCheckboxGroup>
          <SButton
            variant="secondary"
            size="tiny"
            class="ml-auto shrink-0"
            :disabled="!media.lyricContent"
            @click="handleCopyRaw"
          >
            {{ t("player.copyLyric.copyRaw") }}
          </SButton>
        </div>
        <div v-if="hasTranslation || hasRomanization" class="flex flex-wrap gap-2">
          <SButton
            v-if="hasTranslation"
            variant="secondary"
            size="tiny"
            :disabled="saving || previewing"
            @click="media.clearAuxiliaryLyric('translation')"
          >
            {{ t("player.copyLyric.clearTranslation") }}
          </SButton>
          <SButton
            v-if="hasRomanization"
            variant="secondary"
            size="tiny"
            :disabled="saving || previewing"
            @click="media.clearAuxiliaryLyric('romanization')"
          >
            {{ t("player.copyLyric.clearRomanization") }}
          </SButton>
        </div>
      </div>
      <div class="flex flex-col gap-2 border-t border-outline-variant/30 pt-3">
        <span class="text-xs text-on-surface/50">{{ t("player.copyLyric.saveFullLyrics") }}</span>
        <div class="flex flex-wrap items-center gap-3">
          <SCheckbox
            :checked="canWriteMetadata && saveMetadata"
            :disabled="!canWriteMetadata || saving || previewing"
            :label="t('player.copyLyric.musicTags')"
            size="small"
            @update:checked="saveMetadata = $event"
          />
          <SCheckbox
            v-model:checked="saveLrc"
            :disabled="saving || previewing"
            :label="t('player.copyLyric.lrcFile')"
            size="small"
          />
          <SCheckbox
            v-model:checked="saveTtml"
            :disabled="saving || previewing"
            :label="t('player.copyLyric.ttmlFile')"
            size="small"
          />
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <SButton
              variant="secondary"
              size="small"
              :loading="previewing"
              :disabled="!canSaveLyrics || saving"
              @click="handlePreviewLyrics"
            >
              {{ t("player.copyLyric.preview.title") }}
            </SButton>
            <SButton
              variant="secondary"
              size="small"
              :loading="saving"
              :disabled="!canSaveLyrics || previewing"
              @click="handleSaveLyrics"
            >
              {{ t("player.copyLyric.saveLyrics") }}
            </SButton>
          </div>
        </div>
        <div v-if="saveLrc" class="flex flex-col gap-1">
          <SSelect
            class="w-48"
            :model-value="compatibleFormat"
            :options="formatOptions"
            :disabled="saving || previewing"
            :aria-label="t('player.copyLyric.compatibleFormat')"
            @update:model-value="compatibleFormat = $event as CompatibleLyricFormat"
          />
          <p class="text-xs text-on-surface/60">
            {{ t(`player.copyLyric.formatHints.${compatibleFormat}`) }}
            {{ hasTranslation || hasRomanization ? t("player.copyLyric.companionHint") : "" }}
          </p>
        </div>
        <p v-if="saveTtml || (canWriteMetadata && saveMetadata)" class="text-xs text-on-surface/60">
          {{ t("player.copyLyric.saveCompleteHint") }}
          {{
            saveTtml
              ? t(hasTtmlRepo ? "player.copyLyric.saveTtmlHint" : "player.copyLyric.saveTtmlAsHint")
              : ""
          }}
        </p>
        <p
          v-for="(text, index) in saveFeedback"
          :key="index"
          class="text-xs text-on-surface/60 break-all"
        >
          {{ text }}
        </p>
      </div>
    </div>

    <template #footer>
      <span class="mr-auto text-xs text-on-surface/50 tabular-nums">
        {{ t("player.copyLyric.selected", { n: selectedLines.length }) }}
      </span>
      <SButton variant="secondary" @click="toggleSelectAll">
        {{ isAllSelected ? t("player.copyLyric.deselectAll") : t("player.copyLyric.selectAll") }}
      </SButton>
      <SButton variant="secondary" @click="invertSelection">
        {{ t("player.copyLyric.invert") }}
      </SButton>
      <SButton
        variant="secondary"
        :loading="exporting"
        :disabled="!selectedLines.length"
        @click="handleExport"
      >
        {{ t("player.copyLyric.exportImage") }}
      </SButton>
      <SButton type="primary" :disabled="!selectedLines.length" @click="handleCopy">
        {{ t("player.copyLyric.copy") }}
      </SButton>
    </template>
  </SDialog>
  <LyricSavePreviewDialog v-if="previewOpen" v-model:open="previewOpen" :targets="previewTargets" />
</template>
