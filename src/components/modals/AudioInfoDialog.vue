<script setup lang="ts">
import type { AudioStreamInfo } from "@shared/types/player";
import type { AudioSpectrum, LocalAudioInfo } from "@shared/types/audioQuality";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { formatTime } from "@/utils/time";
import * as player from "@/core/player";

const { t } = useI18n();
const media = useMediaStore();
const status = useStatusStore();

const stream = shallowRef<AudioStreamInfo>();
const fileInfo = shallowRef<LocalAudioInfo>();
const spectrum = shallowRef<AudioSpectrum>();
const inspecting = ref(false);
const analyzing = ref(false);
const fileError = ref(false);
const spectrumError = ref(false);
let revision = 0;
let spectrumJob: string | undefined;
const audioPath = computed(() =>
  media.track?.source === "local" ? (media.track.cueAudioPath ?? media.track.path) : undefined,
);

/** 分析实体曲目或当前 CUE 区间，离开后丢弃过期响应 */
const runSpectrum = async (): Promise<void> => {
  const path = audioPath.value;
  if (!status.audioInfoOpen || !path || analyzing.value) return;
  const current = revision;
  const job = crypto.randomUUID();
  spectrumJob = job;
  analyzing.value = true;
  spectrumError.value = false;
  try {
    const response = await window.api.library.analyzeSpectrum(
      path,
      media.track?.cueStartMs ?? 0,
      media.track?.cueEndMs,
      job,
    );
    if (current !== revision) return;
    spectrum.value = response.data;
    spectrumError.value = !response.success;
  } catch {
    if (current === revision) spectrumError.value = true;
  } finally {
    if (spectrumJob === job) spectrumJob = undefined;
    if (current === revision) analyzing.value = false;
  }
};

watch(
  [
    () => status.audioInfoOpen,
    () => media.track?.id,
    () => media.track?.mtime,
    audioPath,
    () => media.track?.cueStartMs,
    () => media.track?.cueEndMs,
  ] as const,
  ([open, _id, _mtime, path], _previous, onCleanup) => {
    const current = ++revision;
    if (!open) return;
    stream.value = undefined;
    fileInfo.value = undefined;
    spectrum.value = undefined;
    fileError.value = false;
    spectrumError.value = false;
    analyzing.value = false;
    inspecting.value = Boolean(path);
    let pending = false;

    /** 只刷新当前弹窗显示的活跃流诊断 */
    const refreshStream = async (): Promise<void> => {
      if (pending || document.hidden || status.isLoading) return;
      pending = true;
      try {
        const response = await window.api.player.getStreamInfo();
        if (current === revision) stream.value = response.success ? response.data : undefined;
      } catch {
        if (current === revision) stream.value = undefined;
      } finally {
        pending = false;
      }
    };
    void refreshStream();
    const timer = window.setInterval(() => void refreshStream(), 1000);
    onCleanup(() => {
      window.clearInterval(timer);
      if (spectrumJob) {
        void window.api.library.cancelSpectrum(spectrumJob).catch(() => {});
        spectrumJob = undefined;
      }
    });
    if (path) {
      void runSpectrum();
      void window.api.library
        .inspectAudio(path)
        .then((response) => {
          if (current !== revision) return;
          fileInfo.value = response.data;
          fileError.value = !response.success;
        })
        .catch(() => {
          if (current === revision) fileError.value = true;
        })
        .finally(() => {
          if (current === revision) inspecting.value = false;
        });
    }
  },
  { immediate: true },
);

/**
 * 保留未知参数的空值
 * @param value - 测量值
 * @param unit - 显示单位
 */
const positive = (value?: number, unit = ""): string =>
  value && value > 0
    ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) + (unit ? " " + unit : "")
    : "—";

/**
 * 格式化带符号的增益值
 * @param gain - 标签增益，单位为 dB
 */
const gainDb = (gain?: number): string =>
  gain == null ? "—" : (gain > 0 ? "+" : "") + gain.toFixed(2) + " dB";

const sourceQuality = computed(() => media.detail?.quality ?? media.track?.quality);
const output = computed(() => (stream.value?.hasOutput ? stream.value : undefined));
const sourceRate = computed(
  () =>
    fileInfo.value?.sampleRate || stream.value?.sourceSampleRate || sourceQuality.value?.sampleRate,
);
const coreCards = computed(() => [
  { label: t("quality.sampleRate"), value: positive((sourceRate.value ?? 0) / 1000, "kHz") },
  {
    label: t("quality.validBitDepth"),
    value: positive(
      fileInfo.value?.validBits ??
        (stream.value?.sourceCodec ? stream.value.sourceBits : sourceQuality.value?.bitsPerSample),
      "bit",
    ),
  },
  {
    label: t("quality.bitRate"),
    value: positive((fileInfo.value?.audioBitRate ?? 0) / 1000, "kbps"),
  },
  {
    label: t("quality.channels"),
    value: positive(
      fileInfo.value?.channels || stream.value?.sourceChannels || sourceQuality.value?.channels,
    ),
  },
]);

/**
 * 将输出流报告的开关映射为界面状态
 * @param active - 当前流状态
 */
const switchText = (active?: boolean): string =>
  active === undefined ? "—" : t(active ? "common.enabled" : "common.disabled");

const direct = computed(() => stream.value?.directStatus ?? "off");
const bypassing = computed(() => ["pending", "verified", "interrupted"].includes(direct.value));

interface InfoSection {
  title: string;
  status?: string;
  items: { label: string; value: string; wide?: boolean }[];
}

const sections = computed<InfoSection[]>(() => [
  {
    title: t("quality.sourceSection"),
    status: inspecting.value
      ? t("quality.inspecting")
      : fileError.value
        ? t("quality.inspectError")
        : "",
    items: [
      {
        label: t("quality.codec"),
        value:
          (
            fileInfo.value?.codec ||
            stream.value?.sourceCodec ||
            sourceQuality.value?.codec
          )?.toUpperCase() || "—",
      },
      {
        label: t("quality.container"),
        value: fileInfo.value?.containerFormat?.split(",")[0] || "—",
      },
      { label: t("quality.channelLayout"), value: fileInfo.value?.channelLayout || "—" },
      {
        label: t("quality.containerBitRate"),
        value: positive((fileInfo.value?.containerBitRate ?? 0) / 1000, "kbps"),
      },
    ],
  },
  {
    title: t("quality.decoderSection"),
    items: [
      {
        label: t("quality.sampleFormat"),
        value: fileInfo.value?.decodedFormat ?? stream.value?.decodeFormat ?? "—",
      },
      { label: t("quality.sampleRate"), value: positive((sourceRate.value ?? 0) / 1000, "kHz") },
      {
        label: t("quality.appliedGain"),
        value: output.value?.isNormalizationActive ? gainDb(output.value.replayGainDb) : "—",
      },
    ],
  },
  {
    title: t("quality.outputSection"),
    items: [
      {
        label: t("quality.outputMode"),
        value: output.value
          ? t(
              output.value.isExclusive
                ? "settings.audioOutputMode.exclusive"
                : "settings.audioOutputMode.shared",
            )
          : t("quality.noOutput"),
      },
      { label: t("quality.backend"), value: output.value?.backend ?? "—" },
      {
        label: t("quality.sampleRate"),
        value: positive((output.value?.outputSampleRate ?? 0) / 1000, "kHz"),
      },
      { label: t("quality.channels"), value: positive(output.value?.outputChannels) },
      {
        label: t("quality.containerBits"),
        value: positive(output.value?.outputContainerBits, "bit"),
      },
      {
        label: t("quality.outputPrecision"),
        value: output.value?.outputFormat
          ? output.value.outputFormat + " · " + positive(output.value.outputBits, "bit")
          : "—",
      },
      { label: t("quality.resampling"), value: switchText(output.value?.isResampling) },
      {
        label: t("quality.softwareVolume"),
        value: output.value ? t(bypassing.value ? "quality.bypassed" : "common.enabled") : "—",
      },
      {
        label: t("settings.outputDevice.label"),
        value: output.value?.deviceName || "—",
        wide: true,
      },
      { label: t("quality.hardwareFormat"), value: t("quality.hardwareUnknown"), wide: true },
    ],
  },
  {
    title: t("quality.dspSection"),
    items: [
      { label: t("equalizer.title"), value: switchText(output.value?.isEqualizerActive) },
      {
        label: t("quality.tempoPitch"),
        value: output.value?.isTempoActive
          ? output.value.speed + "×"
          : switchText(output.value?.isTempoActive),
      },
      {
        label: t("settings.loudnessNormalization.label"),
        value: switchText(output.value?.isNormalizationActive),
      },
      { label: t("quality.limiter"), value: switchText(output.value?.isLimiterActive) },
    ],
  },
]);

const gainRows = computed(() => {
  const info = fileInfo.value;
  return [
    {
      label: t("quality.trackGain"),
      value: info?.replayGainTrackDb,
      display: gainDb(info?.replayGainTrackDb),
    },
    {
      label: t("quality.albumGain"),
      value: info?.replayGainAlbumDb,
      display: gainDb(info?.replayGainAlbumDb),
    },
    {
      label: t("quality.trackPeak"),
      value: info?.replayGainTrackPeak,
      display: positive(info?.replayGainTrackPeak),
    },
    {
      label: t("quality.albumPeak"),
      value: info?.replayGainAlbumPeak,
      display: positive(info?.replayGainAlbumPeak),
    },
    {
      label: t("quality.r128Track"),
      value: info?.r128TrackGainDb,
      display: gainDb(info?.r128TrackGainDb),
    },
    {
      label: t("quality.r128Album"),
      value: info?.r128AlbumGainDb,
      display: gainDb(info?.r128AlbumGainDb),
    },
  ].filter((row) => row.value != null);
});

const chapters = computed(() => {
  const start = media.track?.cueStartMs ?? 0;
  const end = media.track?.cueEndMs ?? Infinity;
  return (
    fileInfo.value?.chapters
      .filter((chapter) => chapter.startMs >= start && chapter.startMs < end)
      .map((chapter) => ({ ...chapter, positionMs: chapter.startMs - start })) ?? []
  );
});

const points = computed(() => {
  const bands = spectrum.value?.relativeBandsDb;
  if (!bands?.length) return "";
  return bands
    .map((db, index) => (index * 400) / Math.max(bands.length - 1, 1) + "," + Math.min(100, -db))
    .join(" ");
});
</script>

<template>
  <SDialog
    v-model:open="status.audioInfoOpen"
    :title="t('quality.outputInfo')"
    width="min(580px, calc(100vw - 24px))"
    height="min(730px, 85vh)"
    destroy-on-close
  >
    <div class="flex flex-col gap-4 px-5">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SCard
          v-for="card in coreCards"
          :key="card.label"
          size="small"
          radius="lg"
          variant="settings"
          class="flex flex-col min-w-0"
        >
          <span class="text-xs text-on-surface-variant">{{ card.label }}</span>
          <span class="text-sm font-semibold tabular-nums mt-0.5">{{ card.value }}</span>
        </SCard>
      </div>
      <SCard v-if="direct !== 'off'" size="small" variant="settings" class="flex flex-col gap-1">
        <h3 class="text-sm font-semibold">{{ t("quality.direct." + direct) }}</h3>
        <p v-if="stream?.directReason" class="text-xs text-on-surface-variant">
          {{ t("quality.directReason." + stream.directReason) }}
        </p>
        <p v-if="stream?.verifiedFrames" class="text-xs text-on-surface-variant tabular-nums">
          {{ t("quality.verifiedFrames", { count: stream.verifiedFrames.toLocaleString() }) }}
        </p>
        <p v-if="stream?.discontinuities" class="text-xs text-on-surface-variant tabular-nums">
          {{ t("quality.underruns", { count: stream.discontinuities.toLocaleString() }) }}
        </p>
      </SCard>

      <section v-for="section in sections" :key="section.title" class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-2">
          <h3 class="shrink-0 text-sm font-semibold">{{ section.title }}</h3>
          <p
            v-if="section.status"
            class="m-0 text-right text-xs text-on-surface-variant"
            role="status"
          >
            {{ section.status }}
          </p>
        </div>
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
          <div
            v-for="item in section.items"
            :key="item.label"
            class="flex gap-2 justify-between min-w-0 text-xs"
            :class="item.wide && 'sm:col-span-2'"
          >
            <dt class="text-on-surface-variant">{{ item.label }}</dt>
            <dd class="text-right font-medium tabular-nums break-words min-w-0">
              {{ item.value }}
            </dd>
          </div>
        </dl>
      </section>

      <section v-if="gainRows.length" class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold">ReplayGain / R128</h3>
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2">
          <div v-for="row in gainRows" :key="row.label" class="flex justify-between gap-2 text-xs">
            <dt class="text-on-surface-variant">{{ row.label }}</dt>
            <dd class="tabular-nums">{{ row.display }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="audioPath" class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">{{ t("quality.spectrum") }}</h3>
          <SButton variant="secondary" size="small" :loading="analyzing" @click="runSpectrum">
            {{ t(spectrum ? "quality.analyzeAgain" : "quality.analyze") }}
          </SButton>
        </div>
        <p v-if="spectrumError" class="text-xs text-error" role="alert">
          {{ t("quality.analysisError") }}
        </p>
        <template v-if="spectrum">
          <SCard v-if="points" size="small" variant="settings">
            <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
              <div
                class="flex flex-col justify-between text-xs text-on-surface-variant tabular-nums"
              >
                <span>0 dB</span>
                <span>−100</span>
              </div>
              <svg
                viewBox="0 0 400 100"
                preserveAspectRatio="none"
                class="block w-full h-24 min-w-0 text-primary"
                role="img"
                :aria-label="t('quality.spectrumChart')"
              >
                <path
                  d="M0 0 H400 M0 50 H400 M0 100 H400"
                  stroke="currentColor"
                  opacity=".18"
                  fill="none"
                />
                <polyline
                  :points="points"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
              <div
                class="col-start-2 flex justify-between text-xs text-on-surface-variant tabular-nums"
              >
                <span>0 Hz</span>
                <span>{{ positive(spectrum.nyquistHz / 2000, "kHz") }}</span>
                <span>{{ positive(spectrum.nyquistHz / 1000, "kHz") }}</span>
              </div>
            </div>
          </SCard>
          <p v-if="spectrum.partial" class="text-xs text-on-surface-variant" role="status">
            {{ t("quality.partialSpectrum") }}
          </p>
          <p v-else-if="spectrum.cutoffHz" class="text-xs font-medium">
            {{
              t("quality.suspectCutoff", { frequency: positive(spectrum.cutoffHz / 1000, "kHz") })
            }}
          </p>
          <p v-else class="text-xs text-on-surface-variant">
            {{
              t(spectrum.windows < 2 ? "quality.insufficientSpectrum" : "quality.noCutoffEvidence")
            }}
          </p>
          <p class="text-xs text-on-surface-variant tabular-nums">
            {{
              t("quality.analyzedDuration", { seconds: positive(spectrum.analyzedSeconds, "s") })
            }}
            <template v-if="spectrum.observedIntegerBits">
              · {{ t("quality.observedBits", { bits: spectrum.observedIntegerBits }) }}
            </template>
          </p>
        </template>
      </section>

      <section v-if="chapters.length" class="flex flex-col gap-2">
        <h3 class="text-sm font-semibold">{{ t("quality.chapters") }}</h3>
        <ul class="m-0 grid list-none gap-1 p-0">
          <li v-for="(chapter, index) in chapters" :key="index">
            <SButton
              variant="secondary"
              size="small"
              class="w-full"
              @click="player.seek(chapter.positionMs)"
            >
              <span class="flex w-full items-baseline gap-3 text-left">
                <span class="text-xs tabular-nums">{{ formatTime(chapter.positionMs) }}</span>
                <span class="break-words">
                  {{ chapter.title || t("quality.chapterNumber", { number: index + 1 }) }}
                </span>
              </span>
            </SButton>
          </li>
        </ul>
      </section>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
