import type { MediaInfo, PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { useSettingsStore } from "@/stores/settings";
import { watchLyricPreference } from "@/services/lyric/loader";
import {
  applyLyricLanguages,
  extractLyricAuthors,
  findLyricIndex,
  normalizeLyricLines,
  parseLyric,
} from "lyric-kit";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { applyLyricCjkTransform } from "@/utils/lyric/cjkTransform";
import { createTranslationTrack } from "@/utils/lyric/translation";
import { applyTimedAuxiliary } from "@/utils/lyric/auxiliary";
import { alignGeneratedLyrics, applyGeneratedLyrics } from "@/utils/lyric/alignment";
import type { AlignedTranslation } from "@/services/lyric/aiAlignment";
import { applyLocalAlignment } from "@/services/lyric/localAlignment";
import type { AlignmentLineResult } from "@shared/types/lyricAlignment";
import {
  getExistingRomanization,
  type GeneratedLyric,
  type GenerationOptions,
  type GenerationMode,
} from "@/services/lyric/aiGeneration";

export const useMediaStore = defineStore("media", () => {
  watchLyricPreference();

  /** 当前歌曲轻量信息 */
  const track = shallowRef<Track | null>(null);

  /** 当前播放的来源上下文 */
  const playbackContext = shallowRef<PlaybackContext>();

  /** 当前歌曲详细信息 */
  const detail = shallowRef<TrackDetail | null>(null);

  /** 当前选中的歌词数据 */
  const activeLyric = ref<LyricData>(null);

  /** 当前歌词原始内容 */
  const lyricContent = ref<LyricInput | null>(null);

  /** 歌词是否正在加载 */
  const lyricLoading = ref(false);

  /** 当前歌词行索引，-1 表示无匹配 */
  const lyricIndex = ref(-1);

  /** 当前歌词格式 */
  const lyricFormat = computed((): LyricFormat | null => activeLyric.value?.format ?? null);

  /** 当前歌词解析结果 */
  const parsedLyric = shallowRef<LyricLine[]>([]);

  /** 当前歌词文件制作者列表 */
  const lyricAuthors = ref<string[]>([]);
  const lyricRevision = ref(0);
  let transformToken = 0;

  /** 同步当前歌词源到主进程 */
  const syncToMain = (): void => {
    try {
      const payload = {
        track: track.value ? toRaw(track.value) : null,
        lyric: toRaw(parsedLyric.value),
        source: activeLyric.value ? toRaw(activeLyric.value) : null,
      };
      window.api.nowPlaying.update(payload);
    } catch (error) {
      console.error("[media] syncToMain failed", error);
    }
  };

  /**
   * 更新 track
   * @param newTrack - 新的歌曲信息
   * @param newDetail - 新的歌曲详细信息；省略则保留现有 detail
   */
  const setTrack = (newTrack: Track, newDetail?: TrackDetail): void => {
    track.value = newTrack;
    if (newDetail) detail.value = newDetail;
    lyricRevision.value++;
  };

  /**
   * 更新当前播放的来源上下文
   * @param context - 播放来源上下文
   */
  const setPlaybackContext = (context?: PlaybackContext): void => {
    playbackContext.value = context;
  };

  /**
   * 把 audio-engine 解析出的元数据合并到当前 Track 上
   * 保留身份字段（id/source/serverId/originalId/platform/path）
   * 对未设置/空值的展示字段做兜底填充（duration/quality）
   * streaming 源的 cover/title/artist/album 已经是服务器返回的权威值，绝不被引擎覆盖
   */
  const enrichTrack = (info: MediaInfo, newDetail?: TrackDetail): void => {
    if (!track.value) return;
    const isStreaming = track.value.source === "streaming";
    // 标题为文件名去后缀派生（如拖拽播放）时，让位给引擎提取的内嵌标签标题
    const fileName = track.value.path?.split(/[\\/]/).pop() ?? "";
    const stem = fileName.replace(/\.[^.]+$/, "");
    const hasExplicitTitle = !!track.value.title && track.value.title !== stem;
    const hasExplicitArtists = track.value.artists && track.value.artists.length > 0;
    track.value = {
      ...track.value,
      title: hasExplicitTitle ? track.value.title : info.title || track.value.title,
      artists: hasExplicitArtists
        ? track.value.artists
        : info.artists && info.artists.length > 0
          ? info.artists
          : track.value.artists,
      album: track.value.album ?? info.album,
      duration: track.value.duration > 0 ? track.value.duration : info.duration,
      cover: isStreaming ? track.value.cover : (track.value.cover ?? info.cover),
      quality: track.value.quality ?? info.quality,
    };
    if (newDetail) detail.value = newDetail;
  };

  /**
   * 兜底封面：当前 track 无封面时把插件命中的远端 URL 填进去
   * 同时写 cover 与 coverOriginal，使全屏大图与背景/取色一并补上；已有封面不覆盖
   * @param url - 封面图片 URL
   */
  const patchCover = (url: string): void => {
    if (!track.value) return;
    if (track.value.cover && track.value.coverOriginal) return;
    track.value = {
      ...track.value,
      cover: track.value.cover || url,
      coverOriginal: track.value.coverOriginal || url,
    };
  };

  /** 重置歌词状态 */
  const resetLyricState = (): void => {
    transformToken++;
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricIndex.value = -1;
    lyricLoading.value = true;
    lyricRevision.value++;
    syncToMain();
  };

  // 监听简繁转换设置变化并重新解析当前歌词
  watch(
    () => useSettingsStore().lyric.cjkTransform,
    () => {
      if (activeLyric.value && lyricContent.value) {
        setLyric(activeLyric.value, lyricContent.value);
      }
    },
  );

  /**
   * 原子写入歌词
   * @param source - 歌词源
   * @param input - 主歌词 + 可选翻译 / 音译；传 null 即清空
   */
  const setLyric = (source: LyricData, input: LyricInput | null): void => {
    const token = ++transformToken;
    let nextLines: LyricLine[] = [];
    let authors: string[] = [];
    const settings = useSettingsStore();
    if (source && input) {
      try {
        const result = parseLyric(
          {
            content: input.content,
            format: source.format,
            translation: input.translation,
            translationFormat: input.translationFormat,
            romaji: input.romaji,
            romajiFormat: input.romajiFormat,
          },
          {
            detectBackground: settings.lyric.detectBackgroundLyrics,
            preferredLang: settings.locale,
            cleanKangxi: true,
            extractMetadata: true,
          },
        );
        nextLines = applyLyricExclude(result.lines, track.value);
        applyTimedAuxiliary(nextLines, { ...input, format: source.format }, settings.locale);
        normalizeLyricLines(nextLines);
        applyLyricLanguages(nextLines);
        authors = result.metadata.authors?.length
          ? result.metadata.authors
          : extractLyricAuthors(input.content, source.format);
      } catch (e) {
        console.error("[media] parse lyric failed:", e);
        nextLines = [];
      }
    }
    // 解析后无有效行视作无歌词
    const hasContent = nextLines.length > 0;
    activeLyric.value = hasContent ? source : null;
    lyricContent.value = hasContent ? input : null;
    parsedLyric.value = nextLines;
    lyricAuthors.value = hasContent && source && input ? authors : [];
    lyricIndex.value = -1;
    lyricLoading.value = false;
    lyricRevision.value++;
    syncToMain();

    // 应用 OpenCC 简繁转换
    const cjkMode = settings.lyric.cjkTransform;
    if (hasContent && cjkMode && cjkMode !== "none") {
      applyLyricCjkTransform(nextLines, cjkMode).then((transformed) => {
        if (token !== transformToken) return;
        parsedLyric.value = transformed;
        lyricRevision.value++;
        syncToMain();
      });
    }
  };

  /**
   * 原子应用完整 AI 译文；版本检查防止切歌或更新歌词后写入过期结果
   * @param revision - 翻译开始时的歌词版本
   * @param translations - 已校验的行下标与译文
   * @param language - 目标语言
   * @returns 是否成功应用
   */
  const applyLyricTranslation = (
    revision: number,
    translations: ReadonlyMap<number, string>,
    language: string,
  ): boolean => {
    if (revision !== lyricRevision.value || !lyricContent.value || !activeLyric.value) return false;
    const lines = parsedLyric.value;
    const expected = lines
      .map((line, index) => (line.words.some((word) => word.word.trim()) ? index : -1))
      .filter((index) => index !== -1);
    if (
      !expected.length ||
      expected.length !== translations.size ||
      expected.some((index) => !translations.get(index)?.trim())
    )
      return false;
    const translation = createTranslationTrack(lines, translations, language, "normalized");
    transformToken++;
    lyricContent.value = { ...toRaw(lyricContent.value), translation, translationFormat: "ttml" };
    parsedLyric.value = lines.map((line, index) => ({
      ...line,
      translatedLyric: translations.get(index) ?? line.translatedLyric,
      translationWords: undefined,
    }));
    lyricRevision.value++;
    syncToMain();
    return true;
  };

  /**
   * 根据播放时间更新歌词行索引
   * @param time - 播放时间
   */
  const updateLyricIndex = (time: number): void => {
    lyricIndex.value = findLyricIndex(parsedLyric.value, time, lyricIndex.value);
  };

  /**
   * 原子应用逐字翻译及音译，辅助轨道沿用既有保存与内容校验流程
   * @param revision - 生成任务的歌词版本
   * @param results - 覆盖整首歌词的语义关联结果
   * @param language - 译文语言
   * @returns 当前歌曲是否仍匹配并成功应用
   */
  const applyAlignedLyricTranslation = (
    revision: number,
    results: ReadonlyMap<number, AlignedTranslation>,
    language: string,
  ): boolean => {
    if (revision !== lyricRevision.value || !lyricContent.value || !activeLyric.value) return false;
    const lines = alignGeneratedLyrics(parsedLyric.value, results);
    if (!lines) return false;
    commitAuxiliaryLyrics(
      lines,
      {
        translation: false,
        romanization: false,
        wordTranslation: true,
        wordRomanization: true,
      },
      language,
    );
    return true;
  };

  /**
   * 统一提交 AI 与算法辅助歌词，同步显示开关、保存数据及歌词窗口
   * @param lines - 已校验并应用辅助结果的新歌词
   * @param options - 本次实际更新的辅助轨道
   * @param language - 翻译轨道语言
   */
  const commitAuxiliaryLyrics = (
    lines: LyricLine[],
    options: GenerationOptions,
    language: string,
  ): void => {
    const input = { ...toRaw(lyricContent.value!) };
    if (options.translation || options.wordTranslation) {
      input.translation = createTranslationTrack(
        lines,
        new Map(
          lines.map((line, index) => [
            index,
            line.translationWords?.length ? line.translationWords : line.translatedLyric,
          ]),
        ),
        language,
        "normalized",
      );
      input.translationFormat = "ttml";
    }
    if (options.romanization || options.wordRomanization) {
      input.romaji = createTranslationTrack(
        lines,
        new Map(
          lines.map((line, index) => [
            index,
            line.romanizationWords?.length ? line.romanizationWords : getExistingRomanization(line),
          ]),
        ),
        "und-Latn",
        "normalized",
      );
      input.romajiFormat = "ttml";
    }
    const settings = useSettingsStore();
    if (options.translation || options.wordTranslation) settings.lyric.showTranslation = true;
    if (options.wordTranslation) settings.lyric.showWordTranslation = true;
    if (options.romanization) settings.lyric.showRomanization = true;
    if (options.wordRomanization) settings.lyric.showWordRomanization = true;
    transformToken++;
    lyricContent.value = input;
    parsedLyric.value = lines;
    lyricRevision.value++;
    syncToMain();
  };

  /**
   * 所选辅助轨道完整生成后一次提交，未勾选轨道的内容与保存数据保持原样
   * @param revision - 生成开始时的歌词版本
   * @param results - 覆盖本次待生成行的所选项目结果
   * @param options - 用户勾选的生成项目
   * @param language - 新译文的目标语言，已有译文仅对齐时保留其语言
   * @param mode - 补齐缺失或从头完整生成
   * @returns 是否成功应用当前版本的完整结果
   */
  const applyGeneratedLyric = (
    revision: number,
    results: ReadonlyMap<number, GeneratedLyric>,
    options: GenerationOptions,
    language: string,
    mode: GenerationMode = "missing",
  ): boolean => {
    if (revision !== lyricRevision.value || !lyricContent.value || !activeLyric.value) return false;
    const lines = applyGeneratedLyrics(parsedLyric.value, results, options, mode);
    if (!lines) return false;
    const input = { ...toRaw(lyricContent.value) };
    let translationLanguage = language;
    if (options.translation || options.wordTranslation) {
      if (mode === "missing" && parsedLyric.value.some((line) => line.translatedLyric.trim())) {
        const meaningful = parsedLyric.value.filter((line) =>
          line.words.some((word) => word.word.trim()),
        );
        translationLanguage =
          meaningful.every((line) => line.translatedLyric.trim()) && input.translation
            ? (parseLyric(
                { content: input.translation, format: input.translationFormat },
                { extractMetadata: true },
              ).metadata.language ?? "und")
            : "und";
      }
    }
    commitAuxiliaryLyrics(lines, options, translationLanguage);
    return true;
  };

  /**
   * 应用本地对齐的可靠行，并将完整辅助轨道交给现有保存与窗口同步流程
   * @param revision - 开始对齐时的歌词版本
   * @param results - 用户选择的已校验行
   * @param realignExisting - 是否允许替换已有完整逐字对齐
   * @returns 歌曲与歌词未变化且成功应用时返回 true
   */
  const applyLocalLyricAlignment = (
    revision: number,
    results: AlignmentLineResult[],
    realignExisting = false,
  ): boolean => {
    if (
      revision !== lyricRevision.value ||
      lyricLoading.value ||
      !lyricContent.value ||
      !activeLyric.value
    )
      return false;
    const lines = applyLocalAlignment(parsedLyric.value, results, realignExisting);
    if (!lines) return false;
    const input = { ...toRaw(lyricContent.value) };
    const language = input.translation
      ? (parseLyric(
          { content: input.translation, format: input.translationFormat },
          { extractMetadata: true },
        ).metadata.language ?? "und")
      : "und";
    commitAuxiliaryLyrics(
      lines,
      {
        translation: false,
        romanization: false,
        wordTranslation: results.some((line) => line.translation),
        wordRomanization: results.some((line) => line.romanization),
      },
      language,
    );
    return true;
  };

  /** 清空所有状态 */
  const clear = (): void => {
    transformToken++;
    track.value = null;
    playbackContext.value = undefined;
    detail.value = null;
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricLoading.value = false;
    lyricIndex.value = -1;
    lyricRevision.value++;
    syncToMain();
  };

  return {
    track,
    playbackContext,
    detail,
    activeLyric,
    lyricContent,
    lyricFormat,
    parsedLyric,
    lyricAuthors,
    lyricLoading,
    lyricIndex,
    lyricRevision,
    setTrack,
    setPlaybackContext,
    enrichTrack,
    patchCover,
    resetLyricState,
    setLyric,
    applyLyricTranslation,
    applyAlignedLyricTranslation,
    applyGeneratedLyric,
    applyLocalLyricAlignment,
    updateLyricIndex,
    clear,
  };
});
