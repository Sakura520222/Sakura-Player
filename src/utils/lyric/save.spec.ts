import { describe, expect, it } from "vitest";
import { parseLyric } from "lyric-kit";
import { LYRIC_SAVE_FIXTURES } from "@shared/testFixtures/lyricSave";
import { LYRIC_COMPATIBLE_FORMATS, type LyricLine } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { restoreAuxiliaryTracks } from "@shared/utils/lyricAuxiliary";
import { parseCompatibleExport, serializeCompatibleLyrics } from "@shared/utils/lyricCompatible";
import {
  listTtmlOwners,
  parseExportTtml,
  readTtmlDocument,
  TTML_NS,
} from "@shared/utils/lyricTtml";
import { createLyricSaveContent } from "./save";
import { parseDownloadLyrics } from "./serialize";

const track: Track = {
  id: "123",
  source: "netease",
  title: '歌曲 & "标题"',
  artists: [{ id: "a", name: "歌手 & 合唱" }],
  duration: 30_000,
};

describe("可交换的歌词文件", () => {
  it.each(["div", "body"])("修复 %s 的空命名空间后保存全部声部与逐字辅助轨道", (container) => {
    const original = `<tt xmlns="${TTML_NS}" xmlns:ttm="${TTML_NS}#metadata" xmlns:tts="${TTML_NS}#styling" xmlns:amll="http://www.example.com/ns/amll" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata xmlns=""><ttm:agent xml:id="v1" type="person"/><amll:meta key="ttmlAuthorGithub" value="author"/></metadata><styling xmlns=""><style xml:id="accent" tts:color="red"/></styling></head><body${container === "body" ? ' xmlns=""' : ""}><div${container === "div" ? ' xmlns=""' : ""}><p begin="1s" end="3s" ttm:agent="v1" itunes:key="L1" style="accent" custom="keep"><span begin="1s" end="2s" amll:empty-beat="1">花</span><span begin="2s" end="3s">火</span><span xmlns="${TTML_NS}" ttm:role="x-translation" xml:lang="en"><span begin="1s" end="2s">Flower </span><span begin="2s" end="3s">fire</span></span><span ttm:role="x-roman" xml:lang="ja-Latn"><span begin="1s" end="2s">hana</span><span begin="2s" end="3s">bi</span></span><span ttm:role="x-bg" begin="2s" end="3s"><span begin="2s" end="3s">echo</span><span ttm:role="x-translation">回声</span></span></p></div></body></tt>`;
    const input = { content: original, format: "ttml" as const };
    const doc = readTtmlDocument(original);
    expect(listTtmlOwners(doc)).toHaveLength(2);
    expect(doc.getElementsByTagNameNS(TTML_NS, "metadata")).toHaveLength(1);
    expect(doc.getElementsByTagNameNS(TTML_NS, "style")[0].getAttribute("xml:id")).toBe("accent");
    const lines = parseDownloadLyrics(input);
    expect(lines).toHaveLength(2);
    expect(lines[0].translationWords?.map(({ word }) => word)).toEqual(["Flower ", "fire"]);
    expect(lines[0].romanizationWords).toHaveLength(2);
    const { ttml, auxiliary } = createLyricSaveContent(track, lines, input);
    expect(ttml).not.toContain('xmlns=""');
    expect(ttml).toContain('custom="keep"');
    expect(ttml).toContain('style="accent"');
    expect(ttml).toContain('key="ttmlAuthorGithub" value="author"');
    const restored = parseDownloadLyrics({ content: ttml, format: "ttml", auxiliary });
    expect(restored.map(({ isBG }) => isBG)).toEqual([false, true]);
    expect(restored.map(({ words }) => words)).toEqual(lines.map(({ words }) => words));
    expect(
      restored.map(({ translatedLyric, romanLyric, translationWords, romanizationWords }) => ({
        translatedLyric,
        romanLyric,
        translationWords,
        romanizationWords,
      })),
    ).toEqual(
      lines.map(({ translatedLyric, romanLyric, translationWords, romanizationWords }) => ({
        translatedLyric,
        romanLyric,
        translationWords,
        romanizationWords,
      })),
    );
    expect(() =>
      createLyricSaveContent(track, restored, { content: ttml, format: "ttml" }),
    ).not.toThrow();
  });

  it("仅修复 TTML 子树中的空命名空间，不改写扩展 XML 或放宽根节点检查", () => {
    const original = `<tt xmlns="${TTML_NS}" xmlns:custom="urn:custom"><head><metadata><custom:extra><span xmlns="">extension</span></custom:extra><note xmlns=""><p>note</p></note></metadata></head><body><div xmlns=""><p begin="1s" end="2s">歌词</p></div></body></tt>`;
    const doc = readTtmlDocument(original);
    expect(listTtmlOwners(doc)).toHaveLength(1);
    expect(doc.getElementsByTagName("custom:extra")[0].namespaceURI).toBe("urn:custom");
    expect(doc.getElementsByTagName("span")[0].namespaceURI).toBeFalsy();
    expect(doc.getElementsByTagName("note")[0].children[0].namespaceURI).toBeFalsy();
    expect(() => readTtmlDocument(original.replace(`xmlns="${TTML_NS}"`, 'xmlns=""'))).toThrow(
      "tt 或 body",
    );
    expect(() => readTtmlDocument(original.replace('begin="1s"', 'begin="invalid"'))).toThrow(
      "时间表达无效",
    );
  });

  it.each(LYRIC_SAVE_FIXTURES)("$format 原文及辅助轨道通过 TTML 往返", (input) => {
    const { lines } = parseLyric(input);
    const { ttml } = createLyricSaveContent(track, lines, input);
    const result = parseExportTtml(ttml);
    expect(result.metadata.title).toEqual([track.title]);
    expect(result.metadata.platformIds?.ncmMusicId).toEqual([track.id]);
    expect(
      result.lines.map(({ words }) =>
        words.map(({ word, startTime, endTime }) => [word, startTime, endTime]),
      ),
    ).toEqual(
      lines.map(({ words }) =>
        words.map(({ word, startTime, endTime }) => [word, startTime, endTime]),
      ),
    );
    expect(
      result.lines.map(({ translatedLyric, romanLyric }) => [translatedLyric, romanLyric]),
    ).toEqual(lines.map(({ translatedLyric, romanLyric }) => [translatedLyric, romanLyric]));
  });

  it.each(LYRIC_COMPATIBLE_FORMATS)("%s 只写真实格式字段，同步导出独立辅助文件", (format) => {
    const lines = parseLyric(LYRIC_SAVE_FIXTURES[0]).lines;
    const result = serializeCompatibleLyrics(lines, format, { title: [track.title] });
    const [parsed] = parseCompatibleExport(result.lrc, format);
    expect(parsed.startTime).toBe(lines[0].startTime);
    expect(parsed.words.map((word) => word.word).join("")).toBe("逐字歌词");
    if (format === "lrc") {
      expect(result.lrc).toBe(`[ti:${track.title}]\n[00:01.234]逐字歌词\n[00:05.000]`);
      expect(parseLyric(result.lrc).lines[0].endTime).toBe(5000);
    } else expect(parsed.words.map((word) => word.startTime)).toEqual([1234, 2100, 3500]);
    if (format === "qrc" || format === "yrc" || format === "lys")
      expect(parsed.words.map((word) => word.endTime)).toEqual([2000, 3000, 5000]);
    expect(result.translation).toContain("[00:01.234]翻译原文 & 标点");
    expect(result.romanization).toContain("[00:01.234]zhu zi ge ci");
    expect(result.lrc).not.toContain("sakura-");
  });

  it("TTML 保留多语空白、重复行、同刻词与不同轨道的原词关联", () => {
    const line: LyricLine = {
      startTime: 1000,
      endTime: 2500,
      isBG: false,
      isDuet: false,
      words: [
        { word: "っ", startTime: 1000, endTime: 1000, emptyBeat: 1 },
        { word: "て", startTime: 1000, endTime: 1600 },
        { word: " ", startTime: 1600, endTime: 1600 },
        { word: "한국你好＆!", startTime: 1500, endTime: 2500 },
      ],
      translatedLyric: "한글  & < Chinese",
      translationWords: [
        { word: "한글  & ", startTime: 1000, endTime: 1800, from: 3, to: 3 },
        { word: "< Chinese", startTime: 1800, endTime: 2500, from: 0, to: 1 },
      ],
      translationLanguage: "en",
      romanLyric: "tte hanguk ni hao",
      romanizationWords: [
        { word: "tte ", startTime: 1000, endTime: 1600, from: 0, to: 1 },
        { word: "hanguk ni hao", startTime: 1500, endTime: 2500, from: 3, to: 3 },
      ],
      romanizationLanguage: "und-Latn",
    };
    const second = {
      ...line,
      translatedLyric: "再唱一遍",
      translationWords: undefined,
      translationLanguage: "zh-CN",
    };
    const { ttml, auxiliary } = createLyricSaveContent(
      track,
      [line, second],
      LYRIC_SAVE_FIXTURES[0],
    );
    expect(ttml).toContain('<text for="L1">');
    expect(ttml).toContain('<text for="L2">');
    expect(ttml).not.toMatch(/sakura:|sakura-player|"from"|"to"/);
    const reloaded = parseExportTtml(ttml).lines;
    expect(reloaded.map((row) => row.translatedLyric)).toEqual([
      line.translatedLyric,
      second.translatedLyric,
    ]);
    expect(reloaded[0].words).toEqual(line.words);
    restoreAuxiliaryTracks(reloaded, auxiliary);
    expect(reloaded[0].translationWords).toEqual(line.translationWords);
    expect(reloaded[0].romanizationWords).toEqual(line.romanizationWords);
    expect(reloaded[1].translationWords).toBeUndefined();
    expect(reloaded[1].translationLanguage).toBe("zh-CN");
    expect(
      createLyricSaveContent(track, reloaded, { content: ttml, format: "ttml" }).auxiliary,
    ).toEqual(auxiliary);
    expect(() => serializeCompatibleLyrics([line], "enhanced-lrc")).toThrow("TTML");
    expect(serializeCompatibleLyrics([line, second], "lrc").lrc).toBe(
      "[00:01.000]って 한국你好＆! / って 한국你好＆!\n[00:02.500]",
    );
  });

  it("复用 TTML 原有注音、背景、制作者和 XML 样式", () => {
    const original =
      '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:amll="http://www.example.com/ns/amll"><head><metadata><amll:meta key="ttmlAuthorGithub" value="author"/></metadata></head><body><div><p begin="1s" end="3s" custom="keep"><span tts:ruby="container"><span tts:ruby="base">光</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="1s" end="2s">ひかり</span></span></span><span ttm:role="x-roman">hikari</span><span ttm:role="x-translation">旧译文</span><span ttm:role="x-bg" begin="2s" end="3s">echo<span ttm:role="x-translation">旧回声</span></span></p></div></body></tt>';
    const input = { content: original, format: "ttml" as const };
    const { lines } = parseExportTtml(original);
    lines[0].translatedLyric = "Light < glow";
    lines[1].translatedLyric = "Echo & voice";
    const { ttml } = createLyricSaveContent(track, lines, input);
    expect(ttml).toContain('custom="keep"');
    expect(ttml).toContain('key="ttmlAuthorGithub" value="author"');
    expect(ttml).not.toContain("旧译文");
    const saved = parseExportTtml(ttml).lines;
    expect(saved.map((line) => [line.translatedLyric, line.romanLyric])).toEqual([
      ["Light < glow", "hikari"],
      ["Echo & voice", ""],
    ]);
    expect(saved[0].words[0].ruby).toEqual(lines[0].words[0].ruby);
    expect(saved[1].isBG).toBe(true);
  });
});
