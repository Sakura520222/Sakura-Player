<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";
import { saveTrackTags } from "@/core/player";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import { createLyricPoster } from "@/utils/lyric/poster";
import { createLyricSaveContent } from "@/utils/lyric/save";

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

watch(
  () => media.track?.id,
  () => {
    saveFeedback.value = [];
  },
);

/** 保存前固定歌曲与歌词快照，标签写入重载歌曲时不会混入新歌词。 */
const handleSaveLyrics = async (): Promise<void> => {
  const track = media.track;
  const input = media.lyricContent;
  const format = media.lyricFormat;
  if (saving.value || !track || !input || !format || !canSaveLyrics.value) return;
  const lyrics = input.content;
  const lyricData = {
    format,
    translation: input.translation,
    translationFormat: input.translationFormat,
    romaji: input.romaji,
    romajiFormat: input.romajiFormat,
    kana: input.kana,
  };
  const writeMetadata = canWriteMetadata.value && saveMetadata.value;
  const writeLrc = saveLrc.value;
  const ttml = canSaveTtml.value && saveTtml.value ? media.lyricContent?.content : undefined;
  saving.value = true;
  saveFeedback.value = [];
  const saved: string[] = [];
  const failed: string[] = [];
  try {
    // 先保存文件，让标签写入后的歌曲重载能发现同名 LRC 与新的 TTML。
    if (writeLrc || ttml)
      try {
        const content = createLyricSaveContent(track, media.parsedLyric, ttml, lyricData);
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
            :disabled="!canWriteMetadata || saving"
            :label="t('player.copyLyric.musicTags')"
            size="small"
            @update:checked="saveMetadata = $event"
          />
          <SCheckbox
            v-model:checked="saveLrc"
            :disabled="saving"
            :label="t('player.copyLyric.lrcFile')"
            size="small"
          />
          <SCheckbox
            v-if="canSaveTtml"
            v-model:checked="saveTtml"
            :disabled="saving"
            :label="t('player.copyLyric.ttmlFile')"
            size="small"
          />
          <SButton
            variant="secondary"
            size="small"
            class="ml-auto shrink-0"
            :loading="saving"
            :disabled="!canSaveLyrics"
            @click="handleSaveLyrics"
          >
            {{ t("player.copyLyric.saveLyrics") }}
          </SButton>
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
</template>
