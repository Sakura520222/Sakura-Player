import type { SongHighlight, SongHighlightSegment } from "@shared/types/songHighlight";
import { normalizeHighlightSegments } from "@shared/utils/songHighlight";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import * as player from "@/core/player";

/** 当前歌曲的高潮状态由所有播放布局共享，仅保留一份时间轴 */
export const useSongHighlightStore = defineStore("songHighlight", () => {
  const media = useMediaStore();
  const settings = useSettingsStore();
  const status = useStatusStore();
  const highlight = shallowRef<SongHighlight | null>(null);
  const phase = ref<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  let revision = 0;

  const identity = computed(() => {
    const track = media.track;
    return track
      ? JSON.stringify([
          track.source,
          track.id,
          track.serverId,
          track.originalId,
          track.serverRevision,
          track.title,
          track.artists.map((artist) => artist.name),
          track.album?.name,
          track.duration,
        ])
      : "";
  });
  const enabled = computed(
    () => settings.player.showSongHighlight && !!media.track && media.track.source !== "plugin",
  );
  const segments = computed(() =>
    normalizeHighlightSegments(highlight.value?.segments ?? [], status.duration),
  );
  const nextSegment = computed<SongHighlightSegment | undefined>(
    () =>
      segments.value.find((segment) => segment.startMs > status.position + 500) ??
      segments.value[0],
  );

  /**
   * 获取当前歌曲标注，切歌或关闭功能后丢弃旧请求的结果
   * @returns 当前歌曲的有效标注，失败或请求过期时返回 null
   */
  const fetchHighlight = async (): Promise<SongHighlight | null> => {
    const track = media.track;
    if (!enabled.value || !track || status.trackLoading || phase.value === "loading") return null;
    const token = ++revision;
    highlight.value = null;
    phase.value = "loading";
    try {
      const response = await window.api.apis.getSongHighlight(toRaw(track));
      if (token !== revision) return null;
      if (!response.ok) {
        phase.value = "error";
        return null;
      }
      const validSegments = normalizeHighlightSegments(
        response.data?.segments ?? [],
        status.duration,
      );
      highlight.value =
        response.data && validSegments.length
          ? { ...response.data, segments: validSegments }
          : null;
      phase.value = highlight.value ? "ready" : "empty";
      return highlight.value;
    } catch {
      if (token === revision) phase.value = "error";
      return null;
    }
  };

  /**
   * 跳转到已校验的高潮起点，保留当前暂停状态并沿用播放核心的跳转逻辑
   * @param startMs - 指定的高潮起点，省略时选择下一段
   */
  const seekToHighlight = async (startMs = nextSegment.value?.startMs): Promise<void> => {
    if (
      !enabled.value ||
      status.trackLoading ||
      startMs === undefined ||
      !segments.value.some((segment) => segment.startMs === startMs)
    )
      return;
    await player.seek(startMs);
  };

  watch(
    [identity, enabled, () => status.trackLoading],
    () => {
      revision++;
      highlight.value = null;
      phase.value = "idle";
      if (enabled.value && !status.trackLoading) void fetchHighlight();
    },
    { immediate: true, flush: "sync" },
  );
  onScopeDispose(() => revision++);

  return { highlight, phase, enabled, segments, nextSegment, fetchHighlight, seekToHighlight };
});
