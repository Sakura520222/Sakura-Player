<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";
import { saveTrackTags } from "@/core/player";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import { createLyricPoster } from "@/utils/lyric/poster";
import { createLyricSaveContent } from "@/utils/lyric/save";
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
const saveMetadata = ref(true);
const saveLrc = ref(false);
const saveTtml = ref(true);
const saveFeedback = ref<string[]>([]);
const previewing = ref(false);
const previewOpen = ref(false);
const previewTargets = shallowRef<LyricSavePreviewTarget[]>([]);
let previewRequestId = 0;
const canWriteMetadata = computed(
  () => media.track?.source === "local" && !!media.track.path && !media.track.cuePath,
);
const canSaveTtml = computed(
  () =>
    media.lyricFormat === "ttml" &&
    !!media.lyricContent?.content &&
    settings.system.localLyric.enableLocalTTMLOverride &&
    !!settings.system.localLyric.repoDir,
);
const canSaveLyrics = computed(
  () =>
    !!media.track &&
    !media.lyricLoading &&
    !!media.lyricContent?.content &&
    !!media.lyricFormat &&
    media.parsedLyric.length > 0 &&
    ((canWriteMetadata.value && saveMetadata.value) ||
      saveLrc.value ||
      (canSaveTtml.value && saveTtml.value)),
);

const saveSnapshot = computed(() => {
  const track = media.track;
  const input = media.lyricContent;
  const format = media.lyricFormat;
  if (!track || !input || !format) return null;
  return {
    track: toRaw(track),
    lyrics: input.content,
    lyricData: {
      format,
      translation: input.translation,
      translationFormat: input.translationFormat,
      romaji: input.romaji,
      romajiFormat: input.romajiFormat,
      kana: input.kana,
    },
    lines: media.parsedLyric,
    writeMetadata: canWriteMetadata.value && saveMetadata.value,
    writeLrc: saveLrc.value,
    ttml: canSaveTtml.value && saveTtml.value ? input.content : undefined,
  };
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

/** 按保存快照读取原歌词，过期的请求不会重新打开预览。 */
const handlePreviewLyrics = async (): Promise<void> => {
  const snapshot = saveSnapshot.value;
  if (!snapshot || saving.value || previewing.value || !canSaveLyrics.value) return;
  const id = ++previewRequestId;
  previewing.value = true;
  const { track, lyrics, lyricData, lines, writeMetadata, writeLrc, ttml } = snapshot;
  const tasks: Promise<LyricSavePreviewTarget[]>[] = [];
  if (writeMetadata)
    tasks.push(
      (async () => {
        try {
          const result = await window.api.library.readTags(track.path!);
          if (!result.success || !result.data)
            throw new Error(t("player.copyLyric.preview.readFailed"));
          const before = result.data;
          const fields: LyricSavePreviewTarget["fields"] = [
            {
              key: "lyrics",
              before: before.lyrics ?? "",
              after: lyrics,
              beforeFormat: before.lyricData?.format,
              afterFormat: lyricData.format,
            },
            {
              key: "translation",
              before: before.lyricData?.translation ?? "",
              after: lyricData.translation ?? "",
              beforeFormat: before.lyricData?.translationFormat,
              afterFormat: lyricData.translationFormat,
            },
            {
              key: "romaji",
              before: before.lyricData?.romaji ?? "",
              after: lyricData.romaji ?? "",
              beforeFormat: before.lyricData?.romajiFormat,
              afterFormat: lyricData.romajiFormat,
            },
            { key: "kana", before: before.lyricData?.kana ?? "", after: lyricData.kana ?? "" },
          ];
          return [
            {
              key: "metadata",
              path: track.path,
              exists: !!before.lyrics,
              fields: fields.filter((field) => field.before || field.after),
            },
          ];
        } catch (error) {
          return [
            {
              key: "metadata",
              path: track.path,
              fields: [],
              error:
                error instanceof Error ? error.message : t("player.copyLyric.preview.readFailed"),
            },
          ];
        }
      })(),
    );
  if (writeLrc || ttml)
    tasks.push(
      (async () => {
        const selected = (["lrc", "ttml"] as const).filter((key) =>
          key === "lrc" ? writeLrc : !!ttml,
        );
        try {
          const content = createLyricSaveContent(track, lines, ttml, lyricData);
          const result = await window.api.lyrics.previewFiles({
            track,
            lrc: writeLrc ? content.lrc : undefined,
            ttml: content.ttml,
          });
          return selected.map((key): LyricSavePreviewTarget => {
            const before = result[key];
            if (!before || before.status === "failed")
              return {
                key,
                fields: [],
                error: before?.error ?? t("player.copyLyric.preview.readFailed"),
              };
            return {
              key,
              path: before.path,
              exists: before.exists,
              needsDestination: before.needsDestination,
              fields: [{ key: "lyrics", before: before.content, after: content[key]! }],
            };
          });
        } catch (error) {
          return selected.map((key) => ({
            key,
            fields: [],
            error:
              error instanceof Error ? error.message : t("player.copyLyric.preview.readFailed"),
          }));
        }
      })(),
    );
  try {
    const targets = (await Promise.all(tasks)).flat();
    if (id !== previewRequestId) return;
    previewTargets.value = targets;
    previewOpen.value = true;
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

/** 保存前固定歌曲与歌词快照，标签写入重载歌曲时不会混入新歌词。 */
const handleSaveLyrics = async (): Promise<void> => {
  const snapshot = saveSnapshot.value;
  if (saving.value || previewing.value || !snapshot || !canSaveLyrics.value) return;
  const { track, lyrics, lyricData, lines, writeMetadata, writeLrc, ttml } = snapshot;
  saving.value = true;
  saveFeedback.value = [];
  const saved: string[] = [];
  const failed: string[] = [];
  try {
    // 先保存文件，让标签写入后的歌曲重载能发现同名 LRC 与新的 TTML。
    if (writeLrc || ttml)
      try {
        const content = createLyricSaveContent(track, lines, ttml, lyricData);
        const result = await window.api.lyrics.saveFiles({
          track: toRaw(track),
          lrc: writeLrc ? content.lrc : undefined,
          ttml: content.ttml,
        });
        for (const [target, outcome] of Object.entries(result)) {
          const label = target.toUpperCase();
          if (outcome.status === "saved") {
            saved.push(label);
            saveFeedback.value.push(`${label}: ${outcome.path}`);
          } else if (outcome.status === "failed") {
            failed.push(`${label}: ${outcome.error}`);
          }
        }
      } catch {
        failed.push(t("player.copyLyric.saveFilesFailed"));
      }
    if (writeMetadata) {
      try {
        const outcomes = await saveTrackTags([{ path: track.path!, lyrics, lyricData }]);
        const outcome = outcomes?.[0];
        if (outcome?.success) {
          saved.push(t("player.copyLyric.musicTags"));
        } else {
          failed.push(
            `${t("player.copyLyric.musicTags")}: ${outcome?.error ?? t("player.copyLyric.saveFailed")}`,
          );
        }
      } catch {
        failed.push(`${t("player.copyLyric.musicTags")}: ${t("player.copyLyric.saveFailed")}`);
      }
    }
    if (saved.length)
      toast.success(t("player.copyLyric.saveSuccess", { targets: saved.join(" / ") }));
    if (failed.length) {
      saveFeedback.value.push(...failed);
      toast.error(failed.join("\n"));
    }
  } catch {
    toast.error(t("player.copyLyric.saveFailed"));
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
          translation: showTranslation.value && line.translation ? line.translation : undefined,
          romaji: showRomaji.value && line.romaji ? line.romaji : undefined,
          duet: line.duet,
        })),
      fallbackColor: theme.coverColor,
    });
    const artist = track.artists.map((item) => item.name).join(", ");
    const suffixName = t("player.copyLyric.fileSuffix");
    const fileName = `${track.title} - ${artist} - ${suffixName}.png`.replace(/[\\/:*?"<>|]/g, " ");
    const res = await window.api.system.saveFile(await blob.arrayBuffer(), fileName);
    if (res.success && res.path) toast.success(t("player.copyLyric.saved"));
    else if (!res.success) toast.error(t("player.copyLyric.exportFailed"));
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
            v-if="canSaveTtml"
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
        <p class="text-xs text-on-surface/50 leading-relaxed">
          {{
            t(
              canWriteMetadata
                ? "player.copyLyric.saveLocalHint"
                : "player.copyLyric.saveExportHint",
            )
          }}
          {{ t("player.copyLyric.saveCompleteHint") }}
        </p>
        <p v-if="canSaveTtml && saveTtml" class="text-xs text-on-surface/50">
          {{ t("player.copyLyric.saveTtmlHint") }}
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
