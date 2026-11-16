import { describe, expect, it } from "vitest";
import { parseDownloadLyrics } from "./serialize";
import { LYRIC_SAVE_FIXTURES } from "@shared/testFixtures/lyricSave";
import { serializeCompatibleLyrics } from "@shared/utils/lyricCompatible";

describe("下载歌词输入与兼容导出", () => {
  it("解析同步的整行辅助歌词并应用整首时间偏移", () => {
    const lines = parseDownloadLyrics({
      format: "lrc",
      content: "[00:01]Original",
      translation: "[00:01]译文",
      romaji: "[00:01]roma",
      timeShiftMs: 350,
    });
    const output = serializeCompatibleLyrics(lines, "lrc");
    expect(output).toMatchObject({
      lrc: expect.stringMatching(/^\[00:01.350\]Original\n\[/),
      translation: expect.stringMatching(/^\[00:01.350\]译文\n\[/),
      romanization: expect.stringMatching(/^\[00:01.350\]roma\n\[/),
    });
  });

  it("按同一偏移移动 TTML 原始字词和头部辅助片段", () => {
    const input = {
      format: "ttml" as const,
      content:
        '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:i="http://music.apple.com/lyric-ttml-internal"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="zh-CN"><text for="L1"><span begin="1.2s" end="1.8s">歌词</span></text></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="1s" end="2s" i:key="L1"><span begin="1.0s" end="2.0s">Words</span></p></div></body></tt>',
      timeShiftMs: -250,
    };
    const [line] = parseDownloadLyrics(input);
    expect(line.words[0]).toMatchObject({ word: "Words", startTime: 750, endTime: 1750 });
    expect(line.translationWords).toEqual([{ word: "歌词", startTime: 950, endTime: 1550 }]);
  });

  it("丢失辅助逐字能力时仍保留可兼容的独立歌词", () => {
    const lines = parseDownloadLyrics(LYRIC_SAVE_FIXTURES[0]);
    const output = serializeCompatibleLyrics(lines, "enhanced-lrc");
    expect(output.lrc).toContain("<00:01.234>逐<00:02.100>字");
    expect(output.translation).toContain("[00:01.234]翻译原文");
    expect(output.romanization).toContain("[00:01.234]zhu zi ge ci");
  });

  it("只有元数据时没有可供导出的歌词", () => {
    expect(parseDownloadLyrics({ content: "[ti:只有元数据]", format: "lrc" })).toEqual([]);
  });
});
