import { parseLyric, toEnhancedLRC, toLRC } from "lyric-kit";
import type { LyricInput, LyricLine } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";

/**
 * 导出当前完整歌词，给 TTML 补充本地库匹配所需的歌曲元信息
 * @param track - 当前歌曲
 * @param lines - 当前显示的完整歌词，包含翻译、音译和背景人声
 * @param ttml - 当前 TTML 原文，其他格式不传
 * @param auxiliary - 当前外部翻译轨道，导出时合入 TTML 原文
 * @returns 保留逐字时间的 LRC 及可选的 TTML
 */
export const createLyricSaveContent = (
  track: Track,
  lines: LyricLine[],
  ttml?: string,
  auxiliary?: Pick<LyricInput, "translation" | "translationFormat">,
): { lrc: string; ttml?: string } => {
  const exportLines = lines
    .filter((line) => line.words.some((word) => word.word.trim()))
    .map((line) => ({
      ...line,
      romanLyric: line.romanLyric || line.words.map((word) => word.romanWord ?? "").join(""),
    }));
  // 普通 LRC 只保留行起点，逐字片段必须通过增强 LRC 保存起止时间。
  const serialize = exportLines.some((line) => line.words.length > 1) ? toEnhancedLRC : toLRC;
  const lrc = serialize(exportLines, { roundTrip: true });
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
  if (auxiliary?.translation) {
    const translated = parseLyric({ content: ttml, format: "ttml", ...auxiliary }).lines;
    const metadataNamespace = "http://www.w3.org/ns/ttml#metadata";
    const role = (element: Element): string | null =>
      element.getAttributeNS(metadataNamespace, "role") ?? element.getAttribute("ttm:role");
    const body = doc.getElementsByTagName("body")[0];
    const paragraphs = body
      ? Array.from(body.children).flatMap((element) =>
          element.localName === "div"
            ? Array.from(element.getElementsByTagName("p"))
            : element.localName === "p"
              ? [element]
              : [],
        )
      : [];
    const owners = paragraphs.flatMap((paragraph) => [
      paragraph,
      ...Array.from(paragraph.children).filter((element) => role(element) === "x-bg"),
    ]);
    if (owners.length !== translated.length) throw new Error("TTML 译文无法对应原歌词");
    // 仅替换翻译，保留原始逐字、注音、声部及自定义 XML；头部译文优先级高于行内译文。
    for (const element of Array.from(head.getElementsByTagName("*"))) {
      if (element.localName === "translations") element.remove();
    }
    root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:ttm", metadataNamespace);
    for (const [index, owner] of owners.entries()) {
      for (const child of Array.from(owner.children)) {
        if (role(child) === "x-translation") child.remove();
      }
      const text = translated[index].translatedLyric;
      if (!text) continue;
      const span = doc.createElementNS(namespace, "span");
      span.setAttributeNS(metadataNamespace, "ttm:role", "x-translation");
      // 外部轨道是用户选定的当前译文，不再按界面语言过滤。
      span.textContent = text;
      owner.appendChild(span);
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
