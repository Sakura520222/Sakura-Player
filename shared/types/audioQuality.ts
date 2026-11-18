/** 音频容器中的章节位置，单位为毫秒 */
export interface AudioChapter {
  startMs: number;
  endMs?: number;
  title?: string;
}

/** 本地文件音频探测结果 */
export interface LocalAudioInfo {
  codec: string;
  sampleRate: number;
  channels: number;
  validBits: number;
  decodedFormat?: string;
  isLossless: boolean;
  containerFormat?: string;
  audioBitRate?: number;
  containerBitRate?: number;
  channelLayout?: string;
  chapters: AudioChapter[];
  replayGainTrackDb?: number;
  replayGainAlbumDb?: number;
  replayGainTrackPeak?: number;
  replayGainAlbumPeak?: number;
  r128TrackGainDb?: number;
  r128AlbumGainDb?: number;
}

/** 原始采样率下的片段频谱，纵轴相对最高频带 */
export interface AudioSpectrum {
  nyquistHz: number;
  relativeBandsDb: number[];
  analyzedSeconds: number;
  observedIntegerBits?: number;
  cutoffHz?: number;
  windows: number;
  partial: boolean;
}
