import path from "node:path";
import type { Artist } from "@shared/types/player";

export interface CueTrackInfo {
  title: string;
  artists: Artist[];
  album?: { name: string; artist?: string };
  track: number;
  path: string;
  cuePath: string;
  cueAudioPath: string;
  cueStartMs: number;
  cueEndMs: number;
  duration: number;
}

interface CueFile {
  path: string;
  tracks: ParsedCueTrack[];
}

interface ParsedCueTrack {
  number: number;
  audio: boolean;
  title?: string;
  performer?: string;
  index01?: number;
}

interface CueSheetState {
  albumTitle?: string;
  albumPerformer?: string;
  files: CueFile[];
}

const commandPattern = /^\s*([A-Z0-9]+)\s*(.*)$/i;

/** 生成 CUE 分轨在库中的稳定虚拟路径 */
export const toCueTrackPath = (cuePath: string, trackNumber: number): string =>
  `cue://${cuePath}#track=${trackNumber.toString().padStart(2, "0")}`;

/**
 * 从 CUE 虚拟路径中提取真实的 CUE 文件路径
 * @param cueTrackPath - 虚拟路径，格式为 `cue://{cuePath}#track={number}`
 * @returns 真实的 CUE 文件路径，格式不匹配时返回 null
 */
export const extractCuePath = (cueTrackPath: string): string | null => {
  const match = cueTrackPath.match(/^cue:\/\/(.+)#track=\d+$/);
  return match?.[1] ?? null;
};

/** 从 CUE 命令参数中取第一个字段，支持双引号包裹的值 */
const readToken = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed.split(/\s+/)[0] ?? "";
  let token = "";
  for (let i = 1; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === '"') break;
    token += char;
  }
  return token;
};

/** 解析 mm:ss:ff，CUE 帧率固定为 75fps */
const parseIndexMs = (value: string): number | null => {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const frames = Number(match[3]);
  if (!Number.isFinite(minutes) || seconds > 59 || frames > 74) return null;
  return (minutes * 60 + seconds) * 1000 + (frames * 1000) / 75;
};

/** 解析 CUE 文本为内部结构 */
const parseState = (content: string): CueSheetState => {
  const state: CueSheetState = { files: [] };
  let currentFile: CueFile | null = null;
  let currentTrack: ParsedCueTrack | null = null;

  for (const rawLine of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = rawLine.match(commandPattern);
    if (!match) continue;
    const command = match[1].toUpperCase();
    const value = match[2] ?? "";

    if (command === "FILE") {
      currentFile = { path: readToken(value), tracks: [] };
      state.files.push(currentFile);
      currentTrack = null;
      continue;
    }

    if (command === "TRACK") {
      const [index, type] = value.trim().split(/\s+/);
      const number = Number(index);
      currentTrack = null;
      if (!currentFile || !Number.isSafeInteger(number) || number < 1 || number > 99) continue;
      currentTrack = { number, audio: type?.toUpperCase() === "AUDIO" };
      currentFile.tracks.push(currentTrack);
      continue;
    }

    if (command === "TITLE") {
      const title = value.trim().startsWith('"') ? readToken(value) : value.trim();
      if (currentTrack) currentTrack.title = title;
      else state.albumTitle = title;
      continue;
    }

    if (command === "PERFORMER") {
      const performer = value.trim().startsWith('"') ? readToken(value) : value.trim();
      if (currentTrack) currentTrack.performer = performer;
      else state.albumPerformer = performer;
      continue;
    }

    if (command === "INDEX" && currentTrack) {
      const parts = value.trim().split(/\s+/);
      if (parts[0] !== "01") continue;
      const ms = parseIndexMs(parts[1] ?? "");
      if (ms != null) currentTrack.index01 = ms;
    }
  }

  return state;
};

/**
 * 解析分轨并按各自文件时长确定最后一首的终点
 * @param content - CUE 文本
 * @param cuePath - CUE 文件路径或内嵌 CUE 的实体文件路径
 * @param duration - 实体音频时长或按文件路径查询时长的函数
 * @param embedded - 是否使用实体文件替代内嵌 CUE 的文件名
 * @returns 按 CUE 顺序排列的可播放分轨
 */
export const parseCueSheet = (
  content: string,
  cuePath: string,
  duration: number | ((audioPath: string) => number | undefined),
  embedded = false,
): CueTrackInfo[] => {
  const state = parseState(content);
  if ((embedded || typeof duration === "number") && state.files.length !== 1) return [];
  const tracks: CueTrackInfo[] = [];
  const numbers = new Set<number>();
  for (const file of state.files) {
    if (!file.path) continue;
    const audioPath = embedded
      ? cuePath
      : path.resolve(path.dirname(cuePath), file.path.replaceAll("\\", "/"));
    const audioDurationMs = typeof duration === "number" ? duration : duration(audioPath);
    if (!audioDurationMs || audioDurationMs <= 0) continue;
    const indexed = file.tracks
      .filter((track): track is ParsedCueTrack & { index01: number } => track.index01 !== undefined)
      .sort((a, b) => a.index01 - b.index01);
    for (const [index, track] of indexed.entries()) {
      if (!track.audio || numbers.has(track.number)) continue;
      const start = track.index01;
      const end = Math.min(audioDurationMs, indexed[index + 1]?.index01 ?? audioDurationMs);
      if (end <= start) continue;
      const performer = track.performer || state.albumPerformer;
      tracks.push({
        title: track.title || `${path.basename(cuePath, path.extname(cuePath))} #${track.number}`,
        artists: performer ? [{ name: performer }] : [],
        album: state.albumTitle
          ? { name: state.albumTitle, artist: state.albumPerformer }
          : undefined,
        track: track.number,
        path: toCueTrackPath(cuePath, track.number),
        cuePath,
        cueAudioPath: audioPath,
        cueStartMs: start,
        cueEndMs: end,
        duration: end - start,
      });
      numbers.add(track.number);
    }
  }
  return tracks;
};
