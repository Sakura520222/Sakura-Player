import type { MediaInfo, PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type {
  LyricAuxiliaryData,
  LyricData,
  LyricFormat,
  LyricInput,
  LyricLine,
} from "@shared/types/lyrics";
import {
  AUXILIARY_TRACKS,
  captureAuxiliaryTrack,
  restoreAuxiliaryTracks,
} from "@shared/utils/lyricAuxiliary";
import { readTtmlAuxiliary, readTtmlDocument, restoreTtmlWords } from "@shared/utils/lyricTtml";
import { useSettingsStore } from "@/stores/settings";
import { watchLyricPreference } from "@/services/lyric/loader";
import {
  applyLyricLanguages,
  applyTimestampOffset,
  clampLastLineEnd,
  extractLyricAuthors,
  findLyricIndex,
  normalizeLyricLines,
  parseLyric,
} from "lyric-kit";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { applyLyricCjkTransform } from "@/utils/lyric/cjkTransform";
import { applyTimedAuxiliary } from "@/utils/lyric/auxiliary";
import { getRomanizationSpans } from "@/utils/lyric/romanization";
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
  const wordTimed = computed(() => activeLyric.value?.wordTimed ?? false);

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

  // 从原文重新解析，关闭自动生成后不会残留估算时间戳
  watch(
    () => [useSettingsStore().lyric.cjkTransform, useSettingsStore().lyric.autoGenerateWordByWord],
    () => {
      if (activeLyric.value && lyricContent.value) {
        setLyric(activeLyric.value, lyricContent.value);
      }
    },
  );

  /**
   * 解析播放用行并保留未经简繁显示转换的数据
   * @param source - 当前歌词来源及格式
   * @param input - 正文及独立辅助轨道
   * @returns 当前设置下原始歌词、制作者与逐字能力
   */
  const parseCurrentLyrics = (source: NonNullable<LyricData>, input: LyricInput) => {
    let nextLines: LyricLine[] = [];
    let authors: string[] = [];
    let hasWordTiming = false;
    const settings = useSettingsStore();
    const result = parseLyric(
      {
        content: input.content,
        format: source.format,
        translation: input.translation,
        translationFormat: input.translationFormat,
        romaji: input.romaji,
        romajiFormat: input.romajiFormat,
        kana: input.kana,
      },
      {
        detectBackground: settings.lyric.detectBackgroundLyrics,
        preferredLang: settings.locale,
        cleanKangxi: true,
        extractMetadata: true,
      },
    );
    const sourceLines: LyricLine[] = result.lines;
    if (source.format === "ttml") {
      try {
        const doc = readTtmlDocument(input.content);
        restoreTtmlWords(doc, sourceLines);
        readTtmlAuxiliary(doc, sourceLines, settings.locale, input);
      } catch {
        // 旧版或线上 TTML 继续沿用播放解析器，严格校验只约束新写入
      }
    }
    if (source.timeShiftMs) {
      applyTimestampOffset(sourceLines, source.timeShiftMs);
      for (const line of sourceLines)
        for (const [, , field] of AUXILIARY_TRACKS) {
          for (const word of line[field] ?? []) {
            word.startTime = Math.max(0, word.startTime + source.timeShiftMs);
            word.endTime = Math.max(0, word.endTime + source.timeShiftMs);
          }
        }
    }
    nextLines = applyLyricExclude(sourceLines, track.value);
    applyTimedAuxiliary(nextLines, { ...input, format: source.format }, settings.locale);
    normalizeLyricLines(nextLines);
    nextLines = clampLastLineEnd(nextLines, track.value?.duration);
    const segmenter = settings.lyric.autoGenerateWordByWord
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
    for (const line of nextLines) {
      const timed =
        (line.words.length > 1 || ["ttml", "lys", "yrc", "qrc", "krc"].includes(source.format)) &&
        line.words.some((word) => word.endTime > word.startTime);
      if (timed) {
        hasWordTiming = true;
        continue;
      }
      if (!segmenter || line.endTime <= line.startTime) continue;
      const text = line.words.map((word) => word.word).join("");
      const characters = Array.from(segmenter.segment(text), (part) => part.segment);
      if (!characters.length) continue;
      const duration = line.endTime - line.startTime;
      line.words = characters.map((word, index) => ({
        word,
        startTime: line.startTime + Math.round((duration * index) / characters.length),
        endTime: line.startTime + Math.round((duration * (index + 1)) / characters.length),
      }));
      hasWordTiming = true;
    }
    restoreAuxiliaryTracks(nextLines, input.auxiliary);
    applyLyricLanguages(nextLines);
    authors = result.metadata.authors?.length
      ? result.metadata.authors
      : extractLyricAuthors(input.content, source.format);
    return { nextLines, authors, hasWordTiming };
  };

  /** 从原始来源按需恢复导出内容，避免保存播放器显示用的简繁转换 */
  const getLyricExportLines = (): LyricLine[] => {
    const mode = useSettingsStore().lyric.cjkTransform;
    if (mode && mode !== "none" && activeLyric.value && lyricContent.value)
      return parseCurrentLyrics(activeLyric.value, lyricContent.value).nextLines;
    return parsedLyric.value;
  };

  /**
   * 原子写入歌词
   * @param source - 歌词源
   * @param input - 主歌词 + 可选翻译 / 音译；传 null 即清空
   */
  const setLyric = (source: LyricData, input: LyricInput | null): void => {
    const token = ++transformToken;
    let nextLines: LyricLine[] = [];
    let authors: string[] = [];
    let hasWordTiming = false;
    const settings = useSettingsStore();
    if (source && input) {
      try {
        ({ nextLines, authors, hasWordTiming } = parseCurrentLyrics(source, input));
      } catch (e) {
        console.error("[media] parse lyric failed:", e);
        nextLines = [];
      }
    }
    // 解析后无有效行视作无歌词
    const hasContent = nextLines.length > 0;
    activeLyric.value = hasContent && source ? { ...source, wordTimed: hasWordTiming } : null;
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
    const updated = lines.map((line, index) => ({
      ...line,
      translatedLyric: translations.get(index) ?? line.translatedLyric,
      translationWords: undefined,
      translationLanguage: language,
    }));
    commitAuxiliaryLyrics(updated, { translation: true }, language);
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
    options: Partial<GenerationOptions>,
    language: string,
  ): void => {
    const input = { ...toRaw(lyricContent.value!) };
    const updated = { ...input.auxiliary };
    if (options.translation || options.wordTranslation) {
      lines = lines.map((line) =>
        line.translatedLyric && !line.translationLanguage
          ? { ...line, translationLanguage: language }
          : line,
      );
      updated.translation = captureAuxiliaryTrack(lines, "translation");
      delete input.translation;
      delete input.translationFormat;
    }
    if (options.romanization || options.wordRomanization) {
      lines = lines.map((line) => {
        const romanLyric = getExistingRomanization(line);
        return romanLyric && !line.romanizationLanguage
          ? {
              ...line,
              romanLyric,
              romanizationWords: getRomanizationSpans(line),
              romanizationLanguage: "und-Latn",
            }
          : line;
      });
      updated.romanization = captureAuxiliaryTrack(lines, "romanization");
      delete input.romaji;
      delete input.romajiFormat;
    }
    const settings = useSettingsStore();
    if (options.translation || options.wordTranslation) settings.lyric.showTranslation = true;
    if (options.wordTranslation) settings.lyric.showWordTranslation = true;
    if (options.romanization) settings.lyric.showRomanization = true;
    if (options.wordRomanization) settings.lyric.showWordRomanization = true;
    transformToken++;
    lyricContent.value = { ...input, auxiliary: updated };
    parsedLyric.value = lines;
    lyricRevision.value++;
    syncToMain();
  };

  /**
   * 清除一条辅助轨道，并记录清除状态以免重载时恢复旧数据
   * @param track - 要清除的翻译或音译轨道
   */
  const clearAuxiliaryLyric = (track: keyof LyricAuxiliaryData): void => {
    if (!lyricContent.value || lyricLoading.value) return;
    const [, text, words, language] = AUXILIARY_TRACKS[track === "translation" ? 0 : 1];
    const lines = parsedLyric.value.map((line) => ({
      ...line,
      [text]: "",
      [words]: undefined,
      [language]: undefined,
      ...(track === "romanization"
        ? { words: line.words.map((word) => ({ ...word, romanWord: undefined })) }
        : {}),
    }));
    commitAuxiliaryLyrics(lines, { [track]: true }, "und");
  };

  /**
   * 完整生成后一次提交，仅序列化实际返回结果的轨道，保留其他原始保存数据
   * @param revision - 生成开始时的歌词版本
   * @param results - 覆盖本次待生成行的所选项目结果
   * @param options - 用户勾选的生成项目
   * @param language - 新译文的目标语言，已有译文仅对齐时保留其语言
   * @param mode - 补齐缺失或从头完整生成
   * @param regenerateRomanization - 用户选择单独重新音译的失败行
   * @returns 是否成功应用当前版本的完整结果
   */
  const applyGeneratedLyric = (
    revision: number,
    results: ReadonlyMap<number, GeneratedLyric>,
    options: GenerationOptions,
    language: string,
    mode: GenerationMode = "missing",
    regenerateRomanization?: ReadonlySet<number>,
  ): boolean => {
    if (revision !== lyricRevision.value || !lyricContent.value || !activeLyric.value) return false;
    const lines = applyGeneratedLyrics(
      parsedLyric.value,
      results,
      options,
      mode,
      regenerateRomanization,
    );
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
    const generated = Array.from(results.values());
    const translationUpdated = generated.some((line) => line.translation !== undefined);
    const romanizationUpdated = generated.some((line) => line.romanization !== undefined);
    commitAuxiliaryLyrics(
      lines.map((line, index) => {
        const generated = results.get(index)?.translation;
        return generated !== undefined &&
          (mode === "full" ||
            typeof generated === "string" ||
            !parsedLyric.value[index].translatedLyric.trim())
          ? { ...line, translationLanguage: language }
          : line;
      }),
      {
        translation: options.translation && translationUpdated,
        wordTranslation: options.wordTranslation && translationUpdated,
        romanization: options.romanization && romanizationUpdated,
        wordRomanization: options.wordRomanization && romanizationUpdated,
      },
      translationLanguage,
    );
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
    wordTimed,
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
    clearAuxiliaryLyric,
    getLyricExportLines,
    updateLyricIndex,
    clear,
  };
});
