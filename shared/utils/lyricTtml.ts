import { DOMParser, onErrorStopParsing } from "@xmldom/xmldom";
import { parseTTML, parseTTMLTime } from "lyric-kit";
import type { AuxiliaryLyricSpan, LyricInput, LyricLine, LyricWord } from "../types/lyrics";

export const TTML_NS = "http://www.w3.org/ns/ttml";
export const TTM_NS = `${TTML_NS}#metadata`;
export const TTS_NS = `${TTML_NS}#styling`;
export const ITUNES_NS = "http://music.apple.com/lyric-ttml-internal";
export const AMLL_NS = "http://www.example.com/ns/amll";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/**
 * 在主进程和渲染进程以相同规则验证 XML、根节点与歌词时间表达
 * @param content - 待保存的 TTML 歌词
 * @returns 已校验的歌词 XML 文档
 */
export const readTtmlDocument = (content: string): Document => {
  // eslint-disable-next-line no-control-regex -- XML 1.0 禁止这些字符
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(content))
    throw new Error("TTML 包含无效的 XML 字符");
  const doc = new DOMParser({ onError: onErrorStopParsing }).parseFromString(
    content,
    "application/xml",
  ) as unknown as Document;
  const root = doc.documentElement;
  if (
    doc.doctype ||
    root.localName !== "tt" ||
    root.namespaceURI !== TTML_NS ||
    Array.from(root.children).filter(
      (element) => element.localName === "body" && element.namespaceURI === TTML_NS,
    ).length !== 1
  )
    throw new Error("TTML 歌词缺少有效的 tt 或 body");
  const keys = new Set<string>();
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    const language = element.getAttributeNS(XML_NS, "lang");
    if (language && !/^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i.test(language))
      throw new Error(`TTML 语言代码无效（${language}）`);
    const begin = element.getAttribute("begin");
    const end = element.getAttribute("end");
    const duration = element.getAttribute("dur");
    for (const value of [begin, end, duration]) {
      if (value === null) continue;
      if (
        !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h)?|(?:\d+:)?\d+:[0-5]?\d(?:\.\d+)?)$/.test(value.trim()) ||
        !Number.isSafeInteger(parseTTMLTime(value))
      )
        throw new Error(`TTML 时间表达无效（${value}）`);
    }
    if (begin !== null && end !== null && parseTTMLTime(begin) > parseTTMLTime(end))
      throw new Error("TTML 歌词的结束时间早于开始时间");
    if (begin !== null && end === null && duration !== null) {
      const inferred = parseTTMLTime(begin) + parseTTMLTime(duration);
      if (!Number.isSafeInteger(inferred)) throw new Error("TTML 歌词时间超出可用范围");
      element.setAttribute("end", `${inferred}ms`);
    }
    const key = element.getAttributeNS(ITUNES_NS, "key");
    if (key && element.localName === "p") {
      if (keys.has(key)) throw new Error("TTML 歌词行编号重复");
      keys.add(key);
    }
  }
  for (const element of Array.from(doc.getElementsByTagNameNS(ITUNES_NS, "text"))) {
    const forKey = element.getAttribute("for");
    if (!forKey || !keys.has(forKey)) throw new Error("TTML 辅助歌词引用了不存在的歌词行");
  }
  return doc;
};

/**
 * 取得主行和背景声部的 XML 节点，沿用播放器的文档顺序
 * @param doc - 歌词 XML 文档
 * @returns 主行及其紧随的背景行
 */
export const listTtmlOwners = (doc: Document): Element[] => {
  const paragraphs = Array.from(doc.getElementsByTagNameNS(TTML_NS, "p"));
  return paragraphs.flatMap((paragraph) => [
    paragraph,
    ...Array.from(paragraph.children).filter(
      (child) => child.getAttributeNS(TTM_NS, "role") === "x-bg",
    ),
  ]);
};

/**
 * 读取声明了起止时间的片段，保留原始空白与零时长
 * @param parent - 逐字歌词容器
 * @returns 按文档顺序排列的有效片段
 */
const readTimedSpans = (parent: Element): AuxiliaryLyricSpan[] =>
  Array.from(parent.children).flatMap((child) => {
    if (child.localName !== "span" || child.getAttributeNS(TTM_NS, "role")) return [];
    const begin = child.getAttribute("begin");
    const end = child.getAttribute("end");
    if (begin === null || end === null) return [];
    return [
      {
        word: child.textContent ?? "",
        startTime: parseTTMLTime(begin),
        endTime: parseTTMLTime(end),
      },
    ];
  });

/**
 * 从 Apple 风格的头部轨道读取逐字译文、音译与语言，按行键而非时间配对
 * @param doc - 已解析的 TTML 文档
 * @param lines - 以同一文档顺序解析的歌词行
 * @param preferredLang - 播放器的首选译文语言
 * @param input - 优先使用外部辅助轨道的歌词输入
 */
export const readTtmlAuxiliary = (
  doc: Document,
  lines: LyricLine[],
  preferredLang = "",
  input?: LyricInput,
): void => {
  const owners = listTtmlOwners(doc);
  if (owners.length !== lines.length) return;
  const rowByKey = new Map<string, number>();
  owners.forEach((owner, index) => {
    const key = owner.getAttributeNS(ITUNES_NS, "key");
    if (key && owner.localName === "p") rowByKey.set(key, index);
  });
  for (const [tag, role, text, words, language] of [
    ["translation", "x-translation", "translatedLyric", "translationWords", "translationLanguage"],
    ["transliteration", "x-roman", "romanLyric", "romanizationWords", "romanizationLanguage"],
  ] as const) {
    if (tag === "translation" ? input?.translation : input?.romaji) continue;
    const candidates = new Map<number, { node: Element; lang: string; text: string }[]>();
    for (const track of Array.from(doc.getElementsByTagNameNS(ITUNES_NS, tag))) {
      const lang = track.getAttributeNS(XML_NS, "lang") || "und";
      for (const node of Array.from(track.children)) {
        const index = rowByKey.get(node.getAttribute("for") ?? "");
        if (node.localName !== "text" || index === undefined) continue;
        const background = Array.from(node.children).filter(
          (child) => child.getAttributeNS(TTM_NS, "role") === "x-bg",
        );
        const mainText = Array.from(node.childNodes)
          .filter(
            (child) => [1, 3, 4].includes(child.nodeType) && !background.includes(child as Element),
          )
          .map((child) => child.textContent ?? "")
          .join("");
        const lanes = [node, ...background];
        lanes.forEach((entry, offset) => {
          const content = offset === 0 ? mainText : (entry.textContent ?? "");
          if (!content.trim() || (offset && owners[index + offset]?.parentNode !== owners[index]))
            return;
          const matches = candidates.get(index + offset) ?? [];
          matches.push({ node: entry, lang, text: content });
          candidates.set(index + offset, matches);
        });
      }
    }
    for (const [index, owner] of owners.entries()) {
      const line = lines[index];
      const inline = Array.from(owner.children).filter(
        (child) => child.getAttributeNS(TTM_NS, "role") === role,
      );
      const head = candidates.get(index);
      const options =
        head ??
        inline.map((node) => ({
          node,
          lang: node.getAttributeNS(XML_NS, "lang") || "und",
          text: node.textContent ?? "",
        }));
      const selected =
        options.find((option) => option.lang.toLowerCase() === preferredLang.toLowerCase()) ??
        options.find((option) => option.text.replace(/\s+/g, " ").trim() === line[text]) ??
        options[0];
      if (!selected) continue;
      line[language] = selected.lang;
      const spans = readTimedSpans(selected.node);
      // 头部轨道明确标记了行身份，保留词间空白
      if (head || spans.length) line[text] = selected.text;
      line[words] = spans.length ? spans : undefined;
    }
  }
};

/**
 * 恢复显式保留空白的 TTML 原词片段，避免重载时合并空格和零时长片段
 * @param doc - 已验证的 TTML 文档
 * @param lines - 与 XML 节点一一对应的歌词行
 */
export const restoreTtmlWords = (doc: Document, lines: LyricLine[]): void => {
  if (doc.documentElement.getAttributeNS(XML_NS, "space") !== "preserve") return;
  const owners = listTtmlOwners(doc);
  if (owners.length !== lines.length) return;
  for (const [index, owner] of owners.entries()) {
    const line = lines[index];
    const elements = Array.from(owner.children).filter(
      (child) => child.localName === "span" && !child.getAttributeNS(TTM_NS, "role"),
    );
    if (
      !elements.length ||
      !elements.every((child) => child.hasAttribute("begin") && child.hasAttribute("end"))
    )
      continue;
    line.words = elements.map((element): LyricWord => {
      const ruby = element.getAttributeNS(TTS_NS, "ruby") === "container";
      const base = ruby
        ? Array.from(element.children).find(
            (child) => child.getAttributeNS(TTS_NS, "ruby") === "base",
          )
        : element;
      const beat = element.getAttributeNS(AMLL_NS, "empty-beat");
      return {
        word: base?.textContent ?? "",
        startTime: parseTTMLTime(element.getAttribute("begin")!),
        endTime: parseTTMLTime(element.getAttribute("end")!),
        ...(beat ? { emptyBeat: Number(beat) } : {}),
        ...(element.getAttributeNS(AMLL_NS, "obscene") === "true" ? { obscene: true } : {}),
        ...(ruby
          ? {
              ruby: Array.from(element.getElementsByTagNameNS(TTML_NS, "span"))
                .filter((child) => child.getAttributeNS(TTS_NS, "ruby") === "text")
                .map((child) => ({
                  word: child.textContent ?? "",
                  startTime: parseTTMLTime(child.getAttribute("begin") ?? ""),
                  endTime: parseTTMLTime(child.getAttribute("end") ?? ""),
                })),
            }
          : {}),
      };
    });
  }
};

/**
 * 通过播放解析器重读已校验的 TTML，附上它未返回的逐字辅助轨道
 * @param content - 需要重新解析的完整 TTML
 * @param doc - 已校验的同一份 TTML 文档
 * @returns 完整歌词与供保存验证的元数据
 */
export const parseExportTtml = (content: string, doc = readTtmlDocument(content)) => {
  const result = parseTTML(content, {
    domParser: { parseFromString: () => doc },
    extractMetadata: true,
  });
  const lines: LyricLine[] = result.lines;
  restoreTtmlWords(doc, lines);
  readTtmlAuxiliary(doc, lines);
  if (!lines.some((line) => line.words.some((word) => word.word.trim())))
    throw new Error("TTML 文件没有可用的歌词");
  return { ...result, lines };
};
