import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { JsScanEvent, JsScannedTrack } from "@splayer/audio-engine";
import { getEngine } from "./engine";
import {
  getAllTracks,
  upsertTracks,
  deleteTracksByPaths,
  getFileRecords,
  getCueTrackPathsByDirs,
  getEmbeddedCueSheets,
} from "@main/database";
import type { UpsertTrack } from "@main/database/queries";
import { broadcast } from "@main/utils/broadcast";
import { toCacheUrl } from "@main/utils/protocol";
import { toMs } from "@main/utils/time";
import { parseArtists, parseAlbum } from "@main/utils/metadata";
import { getCoverCacheDir, isWin } from "@main/utils/config";
import { libraryLog } from "@main/utils/logger";
import { parseCueSheet, extractCuePath, type CueTrackInfo } from "./cue";
import { readFileAutoEncoding } from "@main/utils/encoding";

let scanning = false;
let scanGeneration = 0;

/**
 * 确认扫描回调和 CUE 收尾仍属于正在运行的任务
 * @param generation - 开始扫描时分配的代次
 */
const isCurrentScan = (generation: number): boolean => scanning && generation === scanGeneration;

/** 路径比较键，Windows 下保持大小写不敏感 */
const pathKey = (value: string): string => {
  const resolved = path.resolve(value);
  return isWin ? resolved.toLowerCase() : resolved;
};

/**
 * Rust 扫描/探测结果 → 数据库 Upsert 记录
 * id 由文件路径哈希生成，标签编辑回灌与扫描共用此规则
 */
export const scannedToUpsert = (track: JsScannedTrack): UpsertTrack => {
  const id = createHash("sha256").update(track.path).digest("hex").slice(0, 16);
  const album = parseAlbum(track.album ?? "");
  return {
    id,
    path: track.path,
    title: track.title || track.path.split(/[/\\]/).pop() || track.path,
    track: track.track,
    artists: track.tags.artists.length
      ? track.tags.artists.map((name) => ({ name }))
      : parseArtists(track.artist ?? ""),
    album: album && { ...album, artist: track.tags.albumArtists.join(" / ") || undefined },
    localTags: track.tags,
    embeddedCue: track.embeddedCue ?? undefined,
    duration: toMs(track.duration),
    cover: toCacheUrl(track.cover),
    codec: track.codec,
    sampleRate: track.sampleRate,
    bitRate: track.bitRate,
    channels: track.channels,
    bitsPerSample: track.bitsPerSample,
    fileSize: track.fileSize,
    mtime: track.mtime,
    ctime: track.ctime,
  };
};

/**
 * 读完外部 CUE 后按最新曲库快照同步分轨
 * @param cueFiles - 本次遍历找到的外部 CUE 文件
 * @param dirs - 本次扫描目录
 * @param unavailableDirs - 本次无法遍历的目录
 * @param generation - 允许写入曲库的扫描代次
 */
const syncCueTracks = async (
  cueFiles: string[],
  dirs: string[],
  unavailableDirs: string[],
  generation: number,
): Promise<number> => {
  const sheets: { path: string; content: string; mtime: number; ctime: number }[] = [];
  const unreadable = new Set<string>();
  for (const cuePath of cueFiles) {
    if (!isCurrentScan(generation)) return 0;
    try {
      const stat = await fs.stat(cuePath);
      const content = await readFileAutoEncoding(cuePath);
      sheets.push({ path: cuePath, content, mtime: stat.mtimeMs, ctime: stat.ctimeMs });
    } catch (error) {
      libraryLog.warn(`解析 CUE 失败 [${cuePath}]:`, error);
      unreadable.add(pathKey(cuePath));
    }
  }
  if (!isCurrentScan(generation)) return 0;

  // 从读取已经结束的快照继承标签，避免覆盖等待 CUE 期间保存的新封面
  const allTracks = getAllTracks();
  // 真实音频文件
  const audioByPath = new Map(
    allTracks.flatMap((track) =>
      !track.cuePath && track.path ? [[pathKey(track.path), track] as const] : [],
    ),
  );
  const upserts: UpsertTrack[] = [];
  const nextPaths = new Set<string>();
  const referencedAudio = new Set<string>();

  /** 保存分轨时继承实体音频的音质和封面 */
  const addTracks = (tracks: CueTrackInfo[], mtime: number, ctime: number): void => {
    for (const cueTrack of tracks) {
      const audio = audioByPath.get(pathKey(cueTrack.cueAudioPath));
      if (!audio?.path) continue;
      referencedAudio.add(pathKey(audio.path));
      nextPaths.add(cueTrack.path);
      upserts.push({
        id: createHash("sha256").update(cueTrack.path).digest("hex").slice(0, 16),
        path: cueTrack.path,
        cuePath: cueTrack.cuePath,
        cueAudioPath: audio.path,
        cueStartMs: cueTrack.cueStartMs,
        cueEndMs: cueTrack.cueEndMs,
        title: cueTrack.title,
        track: cueTrack.track,
        artists: cueTrack.artists.length ? cueTrack.artists : audio.artists,
        album: cueTrack.album ?? audio.album,
        duration: cueTrack.duration,
        cover: audio.cover,
        codec: audio.quality?.codec,
        sampleRate: audio.quality?.sampleRate,
        bitRate: audio.quality?.bitRate,
        channels: audio.quality?.channels,
        bitsPerSample: audio.quality?.bitsPerSample,
        fileSize: audio.fileSize ?? 0,
        mtime,
        ctime,
      });
    }
  };

  /** 从实体曲库中获取分轨边界所用的总时长 */
  const getDuration = (audioPath: string): number | undefined =>
    audioByPath.get(pathKey(audioPath))?.duration;

  for (const track of allTracks) {
    if (track.path && track.cuePath && unreadable.has(pathKey(track.cuePath))) {
      nextPaths.add(track.path);
      if (track.cueAudioPath) referencedAudio.add(pathKey(track.cueAudioPath));
    }
  }
  for (const sheet of sheets) {
    addTracks(parseCueSheet(sheet.content, sheet.path, getDuration), sheet.mtime, sheet.ctime);
  }

  const directoryKeys = dirs.map(
    (dir) => pathKey(dir) + (pathKey(dir).endsWith(path.sep) ? "" : path.sep),
  );
  for (const row of getEmbeddedCueSheets()) {
    const key = pathKey(row.path);
    if (referencedAudio.has(key) || !directoryKeys.some((dir) => key.startsWith(dir))) continue;
    const audio = audioByPath.get(key);
    if (!audio) continue;
    addTracks(
      parseCueSheet(row.embedded_cue, row.path, audio.duration, true),
      audio.mtime ?? 0,
      audio.ctime ?? 0,
    );
  }

  if (upserts.length > 0) upsertTracks(upserts);
  const stalePaths = getCueTrackPathsByDirs(dirs).filter((trackPath) => {
    if (nextPaths.has(trackPath)) return false;
    // 不可达目录下的分轨不删除：从虚拟路径提取真实 cuePath 做目录判断
    const realCuePath = extractCuePath(trackPath);
    if (!realCuePath) return true;
    return !unavailableDirs.some((dir) => realCuePath.startsWith(dir));
  });
  if (stalePaths.length > 0) deleteTracksByPaths(stalePaths);
  return nextPaths.size;
};

/**
 * 完成仍处于活动状态的扫描并同步 CUE
 * @param dirs - 本次扫描目录
 * @param event - 原生扫描完成事件
 * @param generation - 允许写回的扫描代次
 */
const finishScan = async (
  dirs: string[],
  event: JsScanEvent,
  generation: number,
): Promise<void> => {
  if (event.removedPaths && event.removedPaths.length > 0) {
    deleteTracksByPaths(event.removedPaths);
    libraryLog.info(`清理 ${event.removedPaths.length} 个已删除文件`);
  }
  const cueCount = await syncCueTracks(
    event.cueFiles ?? [],
    dirs,
    event.unavailableDirs ?? [],
    generation,
  );
  if (!isCurrentScan(generation)) return;
  scanning = false;
  broadcast("library:scanProgress", {
    phase: "done",
    total: event.total,
    scanned: event.scanned,
  });
  libraryLog.info(`扫描完成: ${event.scanned}/${event.total} 个文件，CUE 分轨 ${cueCount} 首`);
};

/** 是否正在扫描 */
export const isScanning = (): boolean => scanning;

/**
 * 开始扫描
 * @param dirs 扫描目录列表
 * @param incremental 是否增量扫描（跳过未变化的文件）
 */
export const startScan = (dirs: string[], incremental = true): void => {
  if (scanning) {
    libraryLog.warn("已有扫描任务进行中，跳过");
    return;
  }
  if (dirs.length === 0) {
    libraryLog.warn("无扫描目录，跳过");
    return;
  }

  const incrementalData = incremental ? getFileRecords() : undefined;
  const engine = getEngine();
  scanning = true;
  const generation = ++scanGeneration;
  const scannedBefore = Date.now();
  libraryLog.info(`开始扫描 ${dirs.length} 个目录 (增量=${incremental})`);

  // 增量扫描时传入已有文件记录，Rust 端会比对 mtime/size 跳过未变化的文件
  try {
    engine.scanDirs(
      dirs,
      (event: JsScanEvent) => {
        if (!isCurrentScan(generation)) return;
        switch (event.eventType) {
          case "progress": {
            // 批量写入数据库
            if (event.tracks && event.tracks.length > 0) {
              upsertTracks(event.tracks.map(scannedToUpsert), scannedBefore);
            }
            broadcast("library:scanProgress", {
              phase: "scanning",
              total: event.total,
              scanned: event.scanned,
              current: event.current,
            });
            break;
          }
          case "done": {
            void finishScan(dirs, event, generation).catch((error) => {
              if (!isCurrentScan(generation)) return;
              scanning = false;
              libraryLog.error("扫描收尾失败:", error);
              broadcast("library:scanProgress", {
                phase: "done",
                total: event.total,
                scanned: event.scanned,
              });
            });
            break;
          }
        }
      },
      getCoverCacheDir(),
      incrementalData,
    );
  } catch (error) {
    scanning = false;
    throw error;
  }
};

/** 取消正在进行的扫描 */
export const cancelScan = (): void => {
  if (!scanning) return;
  const engine = getEngine();
  engine.cancelScan();
  scanning = false;
  libraryLog.info("已发送扫描取消信号");
};
