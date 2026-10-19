import { formatTtmlTime, parseLyric, toEnhancedLRC, toLRC } from "lyric-kit";
import { applyTimedAuxiliary, getTtmlLyricOwners, getTtmlRole } from "./auxiliary";
import type { LyricInput, LyricLine } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { getRomanizationSpans, ROMANIZATION_LRC_KEY } from "./romanization";
import { TRANSLATION_LRC_KEY, writeAuxiliaryRange } from "./auxiliaryRange";
import { createTranslationTrack } from "./translation";

/**
 * 导出当前完整歌词，给 TTML 补充本地库匹配所需的歌曲元信息
 * @param track - 当前歌曲
 * @param lines - 当前显示的完整歌词，包含翻译、音译和背景人声
 * @param ttml - 当前 TTML 原文，其他格式不传
 * @param auxiliary - 当前外部翻译轨道，导出时合入 TTML 原文
 * @returns 保留逐字时间及辅助原词范围的 LRC 和可选 TTML
 */
export const createLyricSaveContent = (
  track: Track,
  lines: LyricLine[],
  ttml?: string,
  auxiliary?: Pick<LyricInput, "translation" | "translationFormat" | "romaji" | "romajiFormat">,
): { lrc: string; ttml?: string } => {
  const exportLines = lines
    .filter((line) => line.words.some((word) => word.word.trim()))
    .map((line) => ({
      ...line,
      romanizationWords: getRomanizationSpans(line),
      romanLyric: line.romanLyric || line.words.map((word) => word.romanWord ?? "").join(""),
    }));
  // 普通 LRC 只保留行起点，逐字片段必须通过增强 LRC 保存起止时间。
  const serialize = exportLines.some((line) => line.words.length > 1) ? toEnhancedLRC : toLRC;
  // 增强 LRC 按首词时间归并副行，行边界与首词不同时也必须让译文、音译跟随正文。
  let lrc = serialize(
    serialize === toEnhancedLRC
      ? exportLines.map((line) => ({
          ...line,
          startTime: line.words[0]?.startTime ?? line.startTime,
        }))
      : exportLines,
    { roundTrip: true },
  );
  for (const [key, field, textField, language] of [
    [ROMANIZATION_LRC_KEY, "romanizationWords", "romanLyric", "und-Latn"],
    [TRANSLATION_LRC_KEY, "translationWords", "translatedLyric", "und"],
  ] as const) {
    if (
      !exportLines.some(
        (line) =>
          line[field]?.length &&
          (line[field]!.length > 1 || line[field]!.some((part) => part.from !== undefined)),
      )
    )
      continue;
    const auxiliary = createTranslationTrack(
      exportLines,
      new Map(
        exportLines.map((line, index) => [
          index,
          line[field]?.length ? line[field]! : line[textField],
        ]),
      ),
      language,
      "normalized",
    );
    // 普通副行仍供其他播放器显示，扩展标签保留本播放器重载所需的完整范围
    lrc = `[${key}:${encodeURIComponent(auxiliary)}]\n${lrc}`;
  }
  if (!ttml) return { lrc };

  const doc = new DOMParser().parseFromString(ttml, "application/xml");
  const root = doc.documentElement;
  if (root.localName !== "tt" || doc.getElementsByTagName("parsererror").length) {
    throw new Error("TTML 歌词格式无效");
  }
  const namespace = root.namespaceURI;
  let head = doc.getElementsByTagNameNS(namespace, "head")[0];
  if (!head) {
    head = doc.createElementNS(namespace, "head");
    root.insertBefore(head, root.firstChild);
  }
  let metadata = head.getElementsByTagNameNS(namespace, "metadata")[0];
  if (!metadata) {
    metadata = doc.createElementNS(namespace, "metadata");
    head.appendChild(metadata);
  }
  if (auxiliary?.translation || auxiliary?.romaji) {
    const translated: LyricLine[] = parseLyric({
      content: ttml,
      format: "ttml",
      ...auxiliary,
    }).lines;
    applyTimedAuxiliary(translated, { content: ttml, format: "ttml", ...auxiliary });
    const metadataNamespace = "http://www.w3.org/ns/ttml#metadata";
    const owners = getTtmlLyricOwners(doc);
    if (owners.length !== translated.length) throw new Error("TTML 译文无法对应原歌词");
    // 仅替换翻译，保留原始逐字、注音、声部及自定义 XML；头部译文优先级高于行内译文。
    for (const element of Array.from(head.getElementsByTagName("*"))) {
      if (
        (auxiliary.translation && element.localName === "translations") ||
        (auxiliary.romaji && element.localName === "transliterations")
      )
        element.remove();
    }
    root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:ttm", metadataNamespace);
    for (const [index, owner] of owners.entries()) {
      const line = translated[index];
      for (const [enabled, role, text, words] of [
        [auxiliary.translation, "x-translation", line.translatedLyric, line.translationWords],
        [auxiliary.romaji, "x-roman", line.romanLyric, line.romanizationWords],
      ] as const) {
        if (!enabled) continue;
        for (const child of Array.from(owner.children))
          if (getTtmlRole(child) === role) child.remove();
        if (!text) continue;
        const span = doc.createElementNS(namespace, "span");
        span.setAttributeNS(metadataNamespace, "ttm:role", role);
        if (words?.length) {
          for (const word of words) {
            const part = doc.createElementNS(namespace, "span");
            part.setAttribute("begin", formatTtmlTime(word.startTime));
            part.setAttribute("end", formatTtmlTime(word.endTime));
            part.textContent = word.word;
            writeAuxiliaryRange(part, word);
            span.appendChild(part);
          }
        } else span.textContent = text;
        owner.appendChild(span);
      }
    }
  }
  const amllNamespace = "http://www.example.com/ns/amll";
  root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:amll", amllNamespace);
  const values: Array<[string, string[]]> = [
    ["musicName", [track.title]],
    ["artists", track.artists.map((artist) => artist.name)],
  ];
  if (track.source === "netease") values.push(["ncmMusicId", [track.id]]);
  if (track.source === "qqmusic") values.push(["qqMusicId", [track.extId ?? track.id]]);
  for (const [key, entries] of values) {
    for (const node of Array.from(head.getElementsByTagNameNS(amllNamespace, "meta"))) {
      if (node.getAttribute("key") === key) node.remove();
    }
    for (const value of entries) {
      const meta = doc.createElementNS(amllNamespace, "amll:meta");
      meta.setAttribute("key", key);
      meta.setAttribute("value", value);
      metadata.appendChild(meta);
    }
  }
  return { lrc, ttml: new XMLSerializer().serializeToString(doc) };
};
