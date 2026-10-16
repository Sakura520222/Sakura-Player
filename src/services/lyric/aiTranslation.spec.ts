import { describe, expect, it } from "vitest";
import { parseLyric } from "lyric-kit";
import {
  collectTranslationLines,
  createTranslationMessages,
  TranslationDecoder,
} from "./aiTranslation";

const rows = [
  { id: 0, text: "A light beyond the rain", translation: "" },
  { id: 2, text: "A light beyond the rain", translation: "" },
];

describe("AI 歌词翻译数据协议", () => {
  it("只发送原文与必要歌曲信息，空行保留下标间隔", () => {
    const lines = parseLyric("[00:01]A light\n[00:03]Beyond the rain").lines;
    lines.splice(1, 0, { ...lines[0], words: [] });
    const input = collectTranslationLines(lines);
    expect(input.map((row) => row.id)).toEqual([0, 2]);
    lines[0].translatedLyric = "existing translation";
    const messages = createTranslationMessages(input, "zh-CN", {
      title: "Test",
      artists: ["Writer"],
    });
    expect(messages[0].content).toContain("Simplified Chinese");
    expect(JSON.parse(messages[1].content)).toEqual({
      title: "Test",
      artists: ["Writer"],
      lines: [
        { id: 0, text: "A light" },
        { id: 2, text: "Beyond the rain" },
      ],
    });
    expect(messages[1].content).not.toContain("existing translation");
    expect(() => collectTranslationLines(Array.from({ length: 1001 }, () => lines[0]))).toThrow();
    expect(() =>
      collectTranslationLines([
        { ...lines[0], words: [{ word: "x".repeat(64001), startTime: 0, endTime: 1 }] },
      ]),
    ).toThrow();
  });

  it("按完整 JSON 行增量发布，支持任意分片、乱序、围栏与无尾换行", () => {
    const decoder = new TranslationDecoder(rows);
    const output =
      '```jsonl\r\n{"id":2,"translation":"雨后的光🌸"}\r\n{"id":0,"translation":"远方\\"的光"}\n```';
    for (const part of output) decoder.push(part);
    expect([...decoder.finish()]).toEqual([
      [2, "雨后的光🌸"],
      [0, '远方"的光'],
    ]);
  });

  it.each([
    '{"id":1,"translation":"错行"}',
    '{"id":0,"translation":"第一行"}\n{"id":0,"translation":"重复行"}',
    '{"id":0,"translation":""}',
    '{"id":0,"translation":"两行\\n文字"}',
    '{"id":"0","translation":"类型错误"}',
    "这里是你的翻译：",
    '{"id":0,"translation":"' + "x".repeat(16384) + '"}',
  ])("拒绝无效或越界记录，不按返回顺序错配：%#", (output) => {
    const decoder = new TranslationDecoder(rows);
    expect(() => {
      decoder.push(output);
      decoder.finish();
    }).toThrow();
  });

  it("缺行或超过响应总上限都不能完成", () => {
    const decoder = new TranslationDecoder(rows);
    decoder.push('{"id":0,"translation":"已完成的一行"}\n');
    expect(() => decoder.finish()).toThrow();
    expect(() => new TranslationDecoder(rows).push("\n".repeat(1024 * 1024 + 1))).toThrow();
  });
});
