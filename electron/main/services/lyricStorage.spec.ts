import { describe, expect, it } from "vitest";
import { parseLyric } from "lyric-kit";
import { LYRIC_SAVE_FIXTURES } from "@shared/testFixtures/lyricSave";
import { encodeLyricStorage, decodeLyricStorage } from "./lyricStorage";

describe("原始歌词标签数据", () => {
  it.each(LYRIC_SAVE_FIXTURES)("$format 原文、独立轨道及逐字数据完整读回", (input) => {
    const { content, ...data } = input;
    const stored = encodeLyricStorage(content, data);
    const loaded = decodeLyricStorage(content, stored);
    expect(loaded).toEqual(data);
    const original = parseLyric(input);
    expect(original.lines.length).toBeGreaterThan(0);
    expect(parseLyric({ content, ...loaded })).toEqual(original);
    expect(decodeLyricStorage(`${content}\n其他编辑器改写`, stored)).toBeUndefined();
  });

  it("旧文件与损坏附加字段不改变标准歌词原文的读取", () => {
    expect(decodeLyricStorage("[00:01.00]旧歌词", undefined)).toBeUndefined();
    expect(decodeLyricStorage("raw", "not json")).toBeUndefined();
    expect(decodeLyricStorage("raw", '{"version":9}')).toBeUndefined();
  });
});
