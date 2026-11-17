import { XMLSerializer, type Node as XmlNode } from "@xmldom/xmldom";
import { toTTML } from "lyric-kit";
import type { LyricAuxiliaryData, LyricLine, LyricMetadata, LyricSpan } from "../types/lyrics";
import type { Track } from "../types/player";
import { AUXILIARY_TRACKS, captureAuxiliaryTrack } from "./lyricAuxiliary";
import {
  AMLL_NS,
  ITUNES_NS,
  listTtmlOwners,
  parseExportTtml,
  readTtmlDocument,
  TTM_NS,
  TTML_NS,
  TTS_NS,
  XML_NS,
  XMLNS_NS,
} from "./lyricTtml";

export const LEGACY_AUXILIARY_NS = "urn:sakura-player:lyrics";

/**
 * 将毫秒区间写成 TTML 秒单位，避免旧式分秒缩写无法被其他解析器读出
 * @param element - 段落或歌词片段
 * @param timing - 原始时间区间
 */
const setTiming = (element: Element, timing: Pick<LyricSpan, "startTime" | "endTime">): void => {
  for (const [field, ms] of [
    ["begin", timing.startTime],
    ["end", timing.endTime],
  ] as const) {
    if (!Number.isSafeInteger(ms) || ms < 0 || timing.endTime < timing.startTime)
      throw new Error("歌词含有无效的起止时间");
    element.setAttribute(field, `${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, "0")}s`);
  }
};

/**
 * 按 TTML 实际可表达的字段比较原词、声部与时间，忽略播放时的派生字段
 * @param first - 待比较的原歌词行
 * @param second - 往返解析或用于复用 XML 的原歌词行
 * @returns 两份歌词是否保留同一原始演唱内容
 */
const samePrimaryLyrics = (first: readonly LyricLine[], second: readonly LyricLine[]): boolean =>
  first.length === second.length &&
  first.every((line, index) => {
    const other = second[index];
    return (
      line.isBG === other.isBG &&
      line.words.length === other.words.length &&
      line.words.every((word, position) => {
        const actual = other.words[position];
        return (
          word.word === actual.word &&
          word.startTime === actual.startTime &&
          word.endTime === actual.endTime &&
          !!word.obscene === !!actual.obscene &&
          word.emptyBeat === actual.emptyBeat &&
          JSON.stringify(word.ruby ?? []) === JSON.stringify(actual.ruby ?? [])
        );
      })
    );
  });

/**
 * 根据实际歌词和歌曲信息生成可重新匹配的 AMLL TTML，并返回专用原词关联附件
 * @param track - 当前歌曲
 * @param lines - 当前完整歌词
 * @param metadata - 源文件中的语言、平台 ID、制作和曲目信息
 * @param original - 已有 TTML 原文，可复用其 XML 样式和原词结构
 * @returns 可直接交换的 TTML 及可选的播放器关联数据
 */
export const serializeTtmlLyrics = (
  track: Track,
  lines: readonly LyricLine[],
  metadata: LyricMetadata,
  original?: string,
): { ttml: string; auxiliary?: LyricAuxiliaryData } => {
  const preserved = original ? readTtmlDocument(original) : undefined;
  const previous = preserved ? parseExportTtml(original!, preserved).lines : undefined;
  const reuse = preserved && previous && samePrimaryLyrics(lines, previous);
  const wordTimed =
    metadata.timingMode === "Word" ||
    lines.some(
      (line) =>
        line.words.length > 1 ||
        line.words.some(
          (word) => word.ruby?.length || word.emptyBeat !== undefined || word.obscene,
        ),
    );
  const agents = { ...metadata.agents };
  const primary = lines.map((line) => {
    const agentId = line.agentId ?? (line.isDuet ? "v2" : "v1");
    if (!agents[agentId]) agents[agentId] = { id: agentId, type: line.isDuet ? "other" : "person" };
    // 由原有 agent 定义恢复对唱位置，序列化时保留真实演唱者标识
    return { ...line, agentId, isDuet: false, translatedLyric: "", romanLyric: "" };
  });
  const doc = reuse
    ? preserved
    : readTtmlDocument(
        toTTML({
          lines: primary,
          metadata: {
            ...metadata,
            rawProperties: undefined,
            agents,
            language: metadata.language ?? "und",
            timingMode: wordTimed ? "Word" : "Line",
          },
        }),
      );
  const root = doc.documentElement;
  root.setAttributeNS(XMLNS_NS, "xmlns:ttm", TTM_NS);
  root.setAttributeNS(XMLNS_NS, "xmlns:itunes", ITUNES_NS);
  root.setAttributeNS(XMLNS_NS, "xmlns:amll", AMLL_NS);
  if (!root.getAttributeNS(XML_NS, "lang"))
    root.setAttributeNS(XML_NS, "xml:lang", metadata.language ?? "und");
  if (!reuse) root.setAttributeNS(XML_NS, "xml:space", "preserve");
  const owners = listTtmlOwners(doc);
  if (owners.length !== lines.length) throw new Error("TTML 声部无法对应当前歌词");
  let head = doc.getElementsByTagNameNS(TTML_NS, "head")[0];
  if (!head) head = root.insertBefore(doc.createElementNS(TTML_NS, "head"), root.firstChild);
  let meta = head.getElementsByTagNameNS(TTML_NS, "metadata")[0];
  if (!meta) meta = head.insertBefore(doc.createElementNS(TTML_NS, "metadata"), head.firstChild);
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    for (const attr of Array.from(element.attributes)) {
      if (
        attr.namespaceURI === LEGACY_AUXILIARY_NS ||
        (attr.namespaceURI === XMLNS_NS && attr.value === LEGACY_AUXILIARY_NS)
      )
        element.removeAttributeNode(attr);
    }
    if (
      element.namespaceURI === AMLL_NS &&
      element.localName === "meta" &&
      element.getAttribute("key")?.startsWith("sakura-player:")
    )
      element.parentNode?.removeChild(element);
  }
  const values: Array<[string, string[]]> = [
    ["musicName", [track.title]],
    ["artists", track.artists.map((artist) => artist.name)],
  ];
  if (track.album?.name) values.push(["album", [track.album.name]]);
  if (track.source === "netease") values.push(["ncmMusicId", [track.id]]);
  if (track.source === "qqmusic") values.push(["qqMusicId", [track.extId ?? track.id]]);
  for (const [key, entries] of values) {
    for (const element of Array.from(meta.getElementsByTagNameNS(AMLL_NS, "meta")))
      if (element.getAttribute("key") === key) element.parentNode?.removeChild(element);
    for (const value of entries) {
      const item = meta.appendChild(doc.createElementNS(AMLL_NS, "amll:meta"));
      item.setAttribute("key", key);
      item.setAttribute("value", value);
    }
  }

  const groups: { key: string; start: number; end: number }[] = [];
  const usedKeys = new Set(
    owners.map((owner) => owner.getAttributeNS(ITUNES_NS, "key")).filter(Boolean),
  );
  let nextKey = 0;
  owners.forEach((owner, index) => {
    const line = lines[index];
    if (owner.localName === "p") {
      let key = reuse ? owner.getAttributeNS(ITUNES_NS, "key") : null;
      if (!key) {
        do {
          key = `L${++nextKey}`;
        } while (usedKeys.has(key));
        usedKeys.add(key);
      }
      owner.setAttributeNS(ITUNES_NS, "itunes:key", key);
      groups.push({ key, start: index, end: index + 1 });
    } else groups.at(-1)!.end = index + 1;
    if (reuse) return;
    // 格式化的段落缩进会被保留空白的阅读器视为歌词
    for (const child of Array.from(owner.childNodes))
      if (child.nodeType === 3) owner.removeChild(child);
    const spans = Array.from(owner.children).filter(
      (element) => !element.getAttributeNS(TTM_NS, "role"),
    );
    if (
      !wordTimed &&
      line.words.length === 1 &&
      line.words[0].startTime === line.startTime &&
      line.words[0].endTime === line.endTime
    ) {
      owner.insertBefore(doc.createTextNode(line.words[0].word), spans[0]);
      owner.removeChild(spans[0]);
    } else {
      spans.forEach((element, position) => {
        setTiming(element, line.words[position]);
        if (element.getAttributeNS(TTS_NS, "ruby") !== "container") return;
        const ruby = Array.from(element.getElementsByTagNameNS(TTML_NS, "span")).filter(
          (node) => node.getAttributeNS(TTS_NS, "ruby") === "text",
        );
        ruby.forEach((node, rubyIndex) => setTiming(node, line.words[position].ruby![rubyIndex]));
      });
    }
    const voiced = line.words.length ? line.words : [line];
    setTiming(owner, {
      startTime: Math.min(line.startTime, ...voiced.map((word) => word.startTime)),
      endTime: Math.max(line.endTime, ...voiced.map((word) => word.endTime)),
    });
  });

  const apple =
    Array.from(meta.getElementsByTagNameNS(ITUNES_NS, "iTunesMetadata"))[0] ??
    meta.appendChild(doc.createElementNS(ITUNES_NS, "iTunesMetadata"));
  apple.setAttributeNS(XMLNS_NS, "xmlns", ITUNES_NS);
  const auxiliary: LyricAuxiliaryData = {};
  const expected = lines.map((line) => ({
    ...line,
    translatedLyric:
      line.translatedLyric || line.translationWords?.map((part) => part.word).join("") || "",
    romanLyric:
      line.romanLyric ||
      line.romanizationWords?.map((word) => word.word).join("") ||
      line.words
        .map((word) => word.romanWord ?? "")
        .filter(Boolean)
        .join(" "),
  }));
  for (const [key, text, words, language] of AUXILIARY_TRACKS) {
    const tag = key === "translation" ? "translation" : "transliteration";
    const fallbackLanguage = key === "translation" ? "und" : "und-Latn";
    for (const line of expected) {
      // 纯空白辅助行不会写入 TTML，往返校验与关联附件也按无内容处理
      if (!line[text].trim() && !line[words]?.some((word) => word.word.trim())) {
        line[text] = "";
        line[words] = undefined;
      }
      if (!line[language] && line[text].trim()) line[language] = fallbackLanguage;
    }
    const lanes = captureAuxiliaryTrack(expected, key);
    const languages = new Set(lanes.flatMap((row) => (row.text.trim() ? [row.language!] : [])));
    if (lanes.some((row) => row.words?.some((word) => word.from !== undefined)))
      auxiliary[key] = lanes;
    const keepExisting =
      reuse &&
      previous.every(
        (line, index) =>
          line[text] === expected[index][text] &&
          line[language] === expected[index][language] &&
          JSON.stringify(line[words] ?? []) ===
            JSON.stringify(
              expected[index][words]?.map(({ word, startTime, endTime }) => ({
                word,
                startTime,
                endTime,
              })) ?? [],
            ),
      );
    if (keepExisting) continue;
    for (const element of Array.from(head.getElementsByTagName("*")))
      if (element.localName === `${tag}s`) element.parentNode?.removeChild(element);
    const role = key === "translation" ? "x-translation" : "x-roman";
    for (const owner of owners)
      for (const child of Array.from(owner.children))
        if (child.getAttributeNS(TTM_NS, "role") === role) owner.removeChild(child);
    if (!languages.size) continue;
    const container = apple.appendChild(doc.createElementNS(ITUNES_NS, `${tag}s`));
    for (const lang of languages) {
      const lane = container.appendChild(doc.createElementNS(ITUNES_NS, tag));
      lane.setAttributeNS(XML_NS, "xml:lang", lang);
      if (key === "translation") lane.setAttribute("type", "subtitle");
      for (const group of groups) {
        const rows = lanes
          .slice(group.start, group.end)
          .map((row) => (row.language === lang ? row : null));
        if (!rows.some((row) => row?.text.trim())) continue;
        const entry = lane.appendChild(doc.createElementNS(ITUNES_NS, "text"));
        entry.setAttribute("for", group.key);
        rows.forEach((row, index) => {
          const parent =
            index === 0 ? entry : entry.appendChild(doc.createElementNS(ITUNES_NS, "span"));
          if (index) parent.setAttributeNS(TTM_NS, "ttm:role", "x-bg");
          if (!row?.text.trim()) return;
          if (!row.words?.length) parent.textContent = row.text;
          else
            for (const word of row.words) {
              const span = parent.appendChild(doc.createElementNS(ITUNES_NS, "span"));
              setTiming(span, word);
              span.textContent = word.word;
            }
        });
      }
    }
    for (const line of expected) {
      const parts = line[words];
      if (!parts?.length) continue;
      const joined = parts.map((word) => word.word).join("");
      if (joined.replace(/\s+/g, " ").trim() !== line[text].replace(/\s+/g, " ").trim())
        throw new Error("逐字歌词与整行文本不一致，请重新对齐后保存");
      line[text] = joined;
    }
    if (lanes.some((row, index) => row.text !== expected[index][text])) auxiliary[key] = lanes;
  }
  if (!apple.hasChildNodes()) meta.removeChild(apple);

  const xml = new XMLSerializer()
    .serializeToString(doc as unknown as XmlNode)
    .replace(/^<\?xml[^?]*\?>\s*/i, "");
  const ttml = `<?xml version="1.0" encoding="utf-8"?>\n${xml}`;
  const result = parseExportTtml(ttml);
  if (
    !samePrimaryLyrics(expected, result.lines) ||
    result.metadata.title?.[0] !== track.title ||
    AUXILIARY_TRACKS.some(([, text, words, language]) =>
      expected.some((line, index) => {
        const actual = result.lines[index];
        const spans = line[words]?.map(({ word, startTime, endTime }) => ({
          word,
          startTime,
          endTime,
        }));
        return (
          line[text] !== actual[text] ||
          (line[text] && line[language] !== actual[language]) ||
          JSON.stringify(spans ?? []) !== JSON.stringify(actual[words] ?? [])
        );
      }),
    )
  )
    throw new Error("TTML 重新解析后歌词、时间或轨道信息不一致");
  return { ttml, ...(auxiliary.translation || auxiliary.romanization ? { auxiliary } : {}) };
};
