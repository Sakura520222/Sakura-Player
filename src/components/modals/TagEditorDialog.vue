<script setup lang="ts">
import type { Track } from "@shared/types/player";
import { ALL_PLATFORMS, PLATFORM_SHORT_NAME, type Platform } from "@shared/types/platform";
import type { TrackTags, TagEditRequest } from "@shared/types/tagEditor";
import { useStatusStore } from "@/stores/status";
import { searchSongs } from "@/apis/search";
import { rankTagCandidates, type RankedTagCandidate } from "@/utils/tagMatch";
import * as player from "@/core/player";
import { toast } from "@/composables/useToast";
import { formatFileSize } from "@/utils/format";
import { formatTime } from "@/utils/time";
import IconWandSparkles from "~icons/lucide/wand-sparkles";

const props = defineProps<{ open: boolean; track: Track | null }>();
const emit = defineEmits<{ "update:open": [value: boolean]; "after-close": [] }>();

const { t } = useI18n();

/** 文件名 */
const fileName = computed(
  () => (props.track?.cueAudioPath ?? props.track?.path)?.split(/[/\\]/).pop() ?? "",
);

/** 格式 · 大小 摘要行 */
const fileMeta = computed(() => {
  const parts: string[] = [];
  const codec = props.track?.quality?.codec;
  if (codec) parts.push(codec.toUpperCase());
  const size = props.track?.fileSize;
  if (size) parts.push(formatFileSize(size));
  return parts.join(" · ");
});

/** 文件读出的原始标签快照 */
const original = shallowRef<TrackTags | null>(null);
const loading = ref(false);
const saving = ref(false);
const errorMessage = ref("");
const readOnly = computed(() => !original.value?.writable);
let revision = 0;
let lyricRequest = 0;

/** 表单状态 */
const form = reactive({
  title: "",
  artist: "",
  album: "",
  albumArtist: "",
  genre: "",
  composers: "",
  date: "",
  comment: "",
  trackTotal: null as number | null,
  discTotal: null as number | null,
  trackNumber: null as number | null,
  discNumber: null as number | null,
  lyrics: "",
});

/** 新封面 */
const newCoverPath = ref<string | null>(null);
const newCoverPreview = ref<string | null>(null);
const removeCover = ref(false);

/**
 * 重置表单为指定标签的值
 * @param tags 要回填的标签，null 表示重置为初始状态（全空）
 */
const resetForm = (tags: TrackTags | null): void => {
  form.title = tags?.title ?? "";
  form.artist = tags?.artists.length
    ? tags.artists.join("\n")
    : tags?.writable
      ? ""
      : (tags?.artist ?? "");
  form.album = tags?.album ?? "";
  form.albumArtist = tags?.albumArtists.length
    ? tags.albumArtists.join("\n")
    : (tags?.albumArtist ?? "");
  form.genre = tags?.genres.length ? tags.genres.join("\n") : (tags?.genre ?? "");
  form.composers = tags?.composers.join("\n") ?? "";
  form.date = tags?.date ?? "";
  form.comment = tags?.comment ?? "";
  form.trackTotal = tags?.trackTotal ?? null;
  form.discTotal = tags?.discTotal ?? null;
  form.trackNumber = tags?.trackNumber ?? null;
  form.discNumber = tags?.discNumber ?? null;
  form.lyrics = tags?.lyrics ?? "";
  removeCover.value = false;
  newCoverPath.value = null;
  newCoverUrl.value = null;
  newCoverPreview.value = null;
  candidates.value = [];
  candidatesVisible.value = false;
};

/** 选择新封面 */
const pickCover = async (): Promise<void> => {
  const current = revision;
  const result = await window.api.library.pickCoverImage();
  if (current !== revision || !result.success || !result.data) return;
  removeCover.value = false;
  newCoverPath.value = result.data.path;
  newCoverUrl.value = null;
  newCoverPreview.value = result.data.dataUrl;
};

/** 在线封面 URL */
const newCoverUrl = ref<string | null>(null);

/** 在线匹配平台，初始值跟随搜索页偏好，命名与搜索页同源 */
const matchPlatform = ref<Platform>(useStatusStore().searchPlatform);
const platformOptions = ALL_PLATFORMS.map((key) => ({
  value: key,
  label: PLATFORM_SHORT_NAME[key],
}));

const matching = ref(false);
const candidates = shallowRef<RankedTagCandidate[]>([]);
const candidatesVisible = ref(false);

/** 用表单当前的标题 + 艺术家联网搜索候选 */
const handleOnlineMatch = async (): Promise<void> => {
  const keyword = `${form.title.trim()} ${form.artist.trim()}`.trim();
  if (!keyword || matching.value || readOnly.value) return;
  const current = revision;
  matching.value = true;
  try {
    const result = await searchSongs(matchPlatform.value, keyword, 0, 10);
    if (current !== revision) return;
    const ranked = rankTagCandidates(result.items, {
      title: form.title,
      artist: form.artist,
      album: form.album,
      durationMs: props.track?.duration,
    });
    candidates.value = ranked;
    candidatesVisible.value = ranked.length > 0;
    if (ranked.length === 0) toast.info(t("tagEditor.noMatches"));
  } catch {
    if (current === revision) toast.error(t("errors.NETWORK_ERROR"));
  } finally {
    if (current === revision) matching.value = false;
  }
};

/**
 * 拉取选中候选的歌词，保留用户在请求期间输入的内容
 * @param track - 当前选中的候选曲目
 */
const fillLyricFromCandidate = async (track: Track): Promise<void> => {
  const current = revision;
  const request = ++lyricRequest;
  const lyrics = form.lyrics;
  const lookupId = matchPlatform.value === "qqmusic" ? (track.extId ?? track.id) : track.id;
  try {
    const resp = await window.api.lyrics.matchById(matchPlatform.value, lookupId);
    if (
      current === revision &&
      request === lyricRequest &&
      form.lyrics === lyrics &&
      resp.ok &&
      resp.data?.content
    )
      form.lyrics = resp.data.content;
  } catch {
    // 拉取失败保留现有歌词，不打断匹配流程
  }
};

/**
 * 回填候选到表单
 * @param candidate - 用户选中的在线结果
 */
const applyCandidate = (candidate: RankedTagCandidate): void => {
  const online = candidate.track;
  form.title = online.title;
  form.artist = online.artists.map((artist) => artist.name).join("\n");
  if (online.album?.name) form.album = online.album.name;
  const coverUrl = online.coverOriginal ?? online.cover;
  if (coverUrl && /^https?:\/\//i.test(coverUrl)) {
    removeCover.value = false;
    newCoverUrl.value = coverUrl;
    newCoverPath.value = null;
    newCoverPreview.value = coverUrl;
  }
  candidatesVisible.value = false;
  void fillLyricFromCandidate(online);
};

/** 文本字段 diff */
const diffText = (origValue: string | undefined, current: string): string | undefined => {
  return (origValue ?? "") === current ? undefined : current;
};

/** 数字字段 diff */
const diffNumber = (origValue: number | undefined, current: number | null): number | undefined => {
  const next = current ?? 0;
  return (origValue ?? 0) === next ? undefined : next;
};

/**
 * 只在内容变化时提交多值标签
 * @param original - 文件中的独立标签值
 * @param current - 表单中的逐行输入
 */
const diffValues = (original: string[], current: string): string[] | undefined =>
  original.join("\n") === current
    ? undefined
    : current
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

/** 在暂存表单中标记移除封面，再次点击可撤回 */
const toggleCoverRemoval = (): void => {
  removeCover.value = !removeCover.value;
  newCoverPath.value = null;
  newCoverUrl.value = null;
  newCoverPreview.value = null;
};

/** 按打开时的文件版本提交变更 */
const handleSave = async (): Promise<void> => {
  const track = props.track;
  const tags = original.value;
  if (!track?.path || !tags?.writable || saving.value) return;
  const current = revision;
  // 构造编辑请求，仅包含变更的字段
  const edit: TagEditRequest = {
    path: track.path,
    title: diffText(tags.title, form.title),
    artists: diffValues(tags.artists, form.artist),
    album: diffText(tags.album, form.album),
    albumArtists: diffValues(tags.albumArtists, form.albumArtist),
    genres: diffValues(tags.genres, form.genre),
    composers: diffValues(tags.composers, form.composers),
    date: diffText(tags.date, form.date),
    comment: diffText(tags.comment, form.comment),
    trackTotal: diffNumber(tags.trackTotal, form.trackTotal),
    discTotal: diffNumber(tags.discTotal, form.discTotal),
    removeCover: removeCover.value || undefined,
    trackNumber: diffNumber(tags.trackNumber, form.trackNumber),
    discNumber: diffNumber(tags.discNumber, form.discNumber),
    lyrics: diffText(tags.lyrics, form.lyrics),
    coverPath: newCoverPath.value ?? undefined,
    coverUrl: newCoverUrl.value ?? undefined,
  };
  // 如果没有任何变更，直接关闭对话框
  const changed = Object.entries(edit).some(
    ([key, value]) => key !== "path" && value !== undefined,
  );
  if (!changed) {
    emit("update:open", false);
    return;
  }
  edit.expectedRevision = tags.revision;
  errorMessage.value = "";
  saving.value = true;
  try {
    const outcomes = await player.saveTrackTags([edit]);
    if (current !== revision) return;
    const outcome = outcomes?.[0];
    if (outcome?.success) {
      toast.success(t("tagEditor.saveSuccess"));
      emit("update:open", false);
    } else {
      errorMessage.value = outcome?.error || t("tagEditor.saveFailed");
    }
  } catch {
    if (current === revision) errorMessage.value = t("tagEditor.saveFailed");
  } finally {
    if (current === revision) saving.value = false;
  }
};
/** 打开时读取文件快照，关闭动画期间保持当前内容 */
watch(
  () => [props.open, props.track?.path] as const,
  async ([open, path]) => {
    const current = ++revision;
    if (!open || !path || props.track?.cuePath) return;
    loading.value = true;
    saving.value = false;
    matching.value = false;
    errorMessage.value = "";
    original.value = null;
    resetForm(null);
    try {
      const result = await window.api.library.readTags(path);
      if (current !== revision) return;
      if (!result.success || !result.data) {
        errorMessage.value = t("tagEditor.readFailed");
        return;
      }
      original.value = result.data;
      resetForm(result.data);
    } catch {
      if (current === revision) errorMessage.value = t("tagEditor.readFailed");
    } finally {
      if (current === revision) loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <SDialog
    :open="open"
    :title="t('tagEditor.title')"
    width="min(600px, calc(100vw - 24px))"
    @after-close="emit('after-close')"
    @update:open="emit('update:open', $event)"
  >
    <p class="min-h-5 mb-2 text-xs text-on-surface-variant" role="status">
      {{ loading ? t("tagEditor.loading") : original && readOnly ? t("tagEditor.readOnly") : "" }}
    </p>
    <fieldset
      :disabled="loading || saving || readOnly"
      class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
    >
      <!-- 封面 -->
      <div class="flex items-stretch gap-4">
        <SImg
          :src="removeCover ? undefined : (newCoverPreview ?? track?.cover)"
          class="size-24 shrink-0 rounded-lg overflow-hidden"
        />
        <div class="flex flex-col justify-between min-w-0 py-0.5">
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-sm font-medium truncate">{{ fileName }}</span>
            <span class="text-xs text-on-surface-variant/70 truncate">
              {{ track?.path }}
            </span>
            <span v-if="fileMeta" class="text-xs text-on-surface-variant/70">{{ fileMeta }}</span>
          </div>
          <div class="flex flex-wrap gap-2 mt-2">
            <SButton variant="secondary" size="small" :disabled="readOnly" @click="pickCover">
              {{ t("tagEditor.replaceCover") }}
            </SButton>
            <SButton
              v-if="original?.hasCover"
              variant="secondary"
              size="small"
              :disabled="readOnly"
              @click="toggleCoverRemoval"
            >
              {{ t(removeCover ? "tagEditor.undoRemoveCover" : "tagEditor.removeCover") }}
            </SButton>
          </div>
        </div>
      </div>
      <!-- 在线匹配 -->
      <SCard size="small" variant="primary">
        <div class="flex items-center gap-2">
          <span class="flex-1 text-sm text-on-surface">{{ t("tagEditor.matchHint") }}</span>
          <div class="w-24 shrink-0">
            <SSelect v-model="matchPlatform" :options="platformOptions" />
          </div>
          <SButton
            type="primary"
            size="small"
            class="shrink-0"
            :loading="matching"
            :disabled="readOnly || (!form.title.trim() && !form.artist.trim())"
            @click="handleOnlineMatch"
          >
            <template #icon><IconWandSparkles /></template>
            {{ t("tagEditor.onlineMatch") }}
          </SButton>
        </div>
        <!-- 候选列表在同一卡片内展开 -->
        <div v-if="candidatesVisible" class="mt-2.5 flex flex-col gap-0.5 max-h-56 overflow-y-auto">
          <div
            v-for="candidate in candidates"
            :key="candidate.track.id"
            role="button"
            tabindex="0"
            :class="[
              'flex items-center gap-2.5 p-1.5 rounded-md cursor-pointer transition-colors hover:bg-on-surface/8',
              candidate.durationFar && 'opacity-45',
            ]"
            @click="applyCandidate(candidate)"
            @keydown.enter="applyCandidate(candidate)"
          >
            <SImg
              :src="candidate.track.cover"
              class="size-10 shrink-0 rounded-md overflow-hidden"
            />
            <div class="flex flex-col min-w-0 flex-1">
              <span class="text-sm truncate">{{ candidate.track.title }}</span>
              <span class="text-xs text-on-surface-variant/70 truncate">
                {{ candidate.track.artists.map((artist) => artist.name).join(" / ") }}
                <template v-if="candidate.track.album?.name">
                  · {{ candidate.track.album.name }}
                </template>
              </span>
            </div>
            <span class="text-xs text-on-surface-variant/70 tabular-nums shrink-0">
              {{ formatTime(candidate.track.duration) }}
            </span>
          </div>
        </div>
      </SCard>
      <!-- 文本标签 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label
          v-for="key in ['title', 'album', 'date', 'comment'] as const"
          :key="key"
          class="flex flex-col min-w-0 gap-1"
        >
          <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields." + key) }}</span>
          <SInput v-model="form[key]" />
        </label>
        <p class="sm:col-span-2 text-xs text-on-surface-variant">
          {{ t("tagEditor.multiValueHint") }}
        </p>
        <label
          v-for="key in ['artist', 'albumArtist', 'genre', 'composers'] as const"
          :key="key"
          class="flex flex-col min-w-0 gap-1"
        >
          <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields." + key) }}</span>
          <SInput v-model="form[key]" type="textarea" :rows="2" />
        </label>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label
          v-for="key in ['trackNumber', 'trackTotal', 'discNumber', 'discTotal'] as const"
          :key="key"
          class="flex flex-col min-w-0 gap-1"
        >
          <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields." + key) }}</span>
          <SNumberInput v-model="form[key]" :min="0" :max="9999" />
        </label>
      </div>
      <!-- 内嵌歌词 -->
      <label class="flex flex-col gap-1">
        <span class="text-xs text-on-surface-variant">{{ t("tagEditor.fields.lyrics") }}</span>
        <SInput
          v-model="form.lyrics"
          type="textarea"
          :rows="6"
          resize="vertical"
          :placeholder="t('tagEditor.lyricsPlaceholder')"
        />
      </label>
    </fieldset>
    <p v-if="errorMessage" class="mt-3 text-sm text-error break-words" role="alert">
      {{ errorMessage }}
    </p>
    <template #footer>
      <SButton variant="secondary" :disabled="saving" @click="emit('update:open', false)">
        {{ t("common.cancel") }}
      </SButton>
      <SButton :loading="saving" :disabled="loading || readOnly" @click="handleSave">
        {{ t("common.save") }}
      </SButton>
    </template>
  </SDialog>
</template>
