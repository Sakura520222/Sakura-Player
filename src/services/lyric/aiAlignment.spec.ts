import { describe, expect, it } from "vitest";
import { ALIGNMENT_LINES, ALIGNMENT_RESULT } from "@shared/testFixtures/lyricAlignment";
import {
  AlignmentDecoder,
  collectAlignmentLines,
  createAlignmentMessages,
  readTranslationAlignment,
  readRomanizationAlignment,
} from "./aiAlignment";

describe("智能翻译与音译逐字协议", () => {
  it("字符串下标、乱序范围和分开的促音拗音可还原为完整音译", () => {
    const line = {
      id: 14,
      text: "きゃっと!",
      translation: "",
      words: ["き", "ゃ", "っ", "と", "!"].map((text, index) => ({ index, text })),
    };
    const ranged = [
      { index: "4", text: "!" },
      { from: "2", to: "3", text: "tto" },
      { from: "0", to: "1", text: "kya" },
    ];
    const expected = [
      { index: 0, to: 1, text: "kya" },
      { index: 2, to: 3, text: "tto" },
      { index: 4, text: "!" },
    ];
    expect(readRomanizationAlignment(line, ranged)).toEqual(expected);
    expect(readRomanizationAlignment(line, ["kya", "", "", "tto", "!"])).toEqual([
      { index: 0, to: 2, text: "kya" },
      { index: 3, text: "tto" },
      { index: 4, text: "!" },
    ]);
    expect(readRomanizationAlignment(line, ["k", "ya", "", "tto", "!"])).toEqual([
      { index: 0, text: "k" },
      { index: 1, text: "ya" },
      { index: 2, to: 3, text: "tto" },
      { index: 4, text: "!" },
    ]);
    expect(ranged[2]).toEqual({ from: "0", to: "1", text: "kya" });
  });

  it("连续空发音可并入首尾发音，字符串数组按有间隔的输入下标映射", () => {
    const line = collectAlignmentLines(ALIGNMENT_LINES)[0];
    line.words = line.words.map((word, index) => ({ ...word, index: index * 2 + 1 }));
    expect(readRomanizationAlignment(line, ["", "", "kimi"])).toEqual([
      { index: 1, to: 5, text: "kimi" },
    ]);
    expect(readRomanizationAlignment(line, ["kimi", "", ""])).toEqual([
      { index: 1, to: 5, text: "kimi" },
    ]);
    expect(readRomanizationAlignment(line, ["kimi", "to", "aruku"])).toEqual([
      { index: 1, text: "kimi" },
      { index: 3, text: "to" },
      { index: 5, text: "aruku" },
    ]);
  });

  it.each([
    [
      { from: 0, to: 1, text: "kimi" },
      { from: 1, to: 2, text: "aruku" },
    ],
    [{ from: 0, to: 0, text: "kimi" }],
    [{ from: 0, to: 99, text: "kimi" }],
    [{ index: 0, from: 1, to: 2, text: "kimi" }],
    [{ from: "0.0", to: 2, text: "kimi" }],
    ["", "", ""],
    ["kimi", "to"],
    ["kimi", "to", "歩く"],
  ])("兼容范围后仍拒绝重叠、缺词、越界和无效文本：%#", (...parts) => {
    expect(() =>
      readRomanizationAlignment(collectAlignmentLines(ALIGNMENT_LINES)[0], parts),
    ).toThrow();
  });

  it("普通音译错误明确指出具体索引，便于续译修正", () => {
    const line = collectAlignmentLines(ALIGNMENT_LINES)[0];
    expect(() =>
      readRomanizationAlignment(line, [
        { index: 0, text: "kimi" },
        { index: 0, text: "to" },
        { index: 2, text: "aruku" },
      ]),
    ).toThrow("音译字词下标 0 重复或范围重叠");
  });

  it("省略助词的空关联并入最近原词范围，保留译文顺序且不修改输入", () => {
    const line = collectAlignmentLines(ALIGNMENT_LINES)[0];
    const parts = [
      { text: "You ", from: 0, to: 0 },
      { text: "", from: 1, to: 1 },
      { text: "walk", from: 2, to: 2 },
    ];
    const before = structuredClone(parts);
    expect(readTranslationAlignment(line, parts)).toEqual([
      { text: "You ", from: 0, to: 1 },
      { text: "walk", from: 2, to: 2 },
    ]);
    expect(parts).toEqual(before);
  });

  it.each(["leading", "trailing"])("%s 的空关联仍完整覆盖原词，最终不含空片段", (position) => {
    const line = collectAlignmentLines(ALIGNMENT_LINES)[0];
    const parts =
      position === "leading"
        ? [
            { text: "", from: 0, to: 1 },
            { text: "Walk", from: 2, to: 2 },
          ]
        : [
            { text: "You", from: 0, to: 0 },
            { text: "", from: 1, to: 2 },
          ];
    expect(readTranslationAlignment(line, parts)).toEqual([
      { text: position === "leading" ? "Walk" : "You", from: 0, to: 2 },
    ]);
  });

  it("单独的空格片段按译文位置合并，保留前后空白及组合顺序", () => {
    const line = collectAlignmentLines(ALIGNMENT_LINES)[0];
    const parts = [
      { text: "\t", from: 0, to: 0 },
      { text: " ", from: 0, to: 0 },
      { text: "You", from: 0, to: 0 },
      { text: " ", from: 1, to: 1 },
      { text: "walk", from: 2, to: 2 },
      { text: " ", from: 2, to: 2 },
    ];
    const aligned = readTranslationAlignment(line, parts);
    expect(aligned.map((part) => part.text).join("")).toBe(parts.map((part) => part.text).join(""));
    expect(aligned).toEqual([
      { text: "\t You ", from: 0, to: 1 },
      { text: "walk ", from: 2, to: 2 },
    ]);
  });

  it.each([
    [{ text: "", from: 0, to: 2 }],
    [
      { text: "Visible", from: 0, to: 0 },
      { text: "", from: 1, to: 99 },
    ],
    [
      { text: "Visible", from: 0, to: 0 },
      { text: "\n", from: 1, to: 2 },
    ],
    [
      { text: "Visible", from: 0, to: 0 },
      { text: "", from: 2, to: 2 },
    ],
    [
      { text: "Visible", from: 0, to: 0 },
      { text: " ".repeat(8192), from: 1, to: 2 },
    ],
  ])("空关联兼容仍拒绝空译文、越界、控制字符、缺词与合并后超长", (...parts) => {
    const line = collectAlignmentLines(ALIGNMENT_LINES)[0];
    expect(() => readTranslationAlignment(line, parts)).toThrow();
  });

  it("仅发送稳定字词下标和原文，语义重排不改变原始时间戳", () => {
    const source = collectAlignmentLines(ALIGNMENT_LINES);
    const messages = createAlignmentMessages(source, "en", { title: "原创验证", artists: [] });
    const payload = JSON.parse(messages[1].content);
    expect(payload.lines[0].words).toEqual([
      { index: 0, text: "君" },
      { index: 1, text: "と" },
      { index: 2, text: "歩く" },
    ]);
    expect(messages[1].content).not.toContain("startTime");
    const decoder = new AlignmentDecoder(source);
    const output = "```jsonl\n" + JSON.stringify({ id: 0, ...ALIGNMENT_RESULT }) + "\n```";
    for (const chunk of output) decoder.push(chunk);
    expect(decoder.finish().get(0)).toEqual(ALIGNMENT_RESULT);
  });

  it.each([
    "range",
    "coverage",
    "roman-duplicate",
    "roman-missing",
    "control",
    "foreign",
    "duplicate",
    "missing",
  ])("拒绝 %s 无效关联及不完整结果", (failure) => {
    const value = structuredClone({ id: 0, ...ALIGNMENT_RESULT });
    if (failure === "range") value.translation[0].to = 99;
    if (failure === "coverage") value.translation.pop();
    if (failure === "roman-duplicate") value.romanization[1].index = 0;
    if (failure === "roman-missing") value.romanization.pop();
    if (failure === "control") value.translation[0].text = "multi\nline";
    if (failure === "foreign") value.id = 999;
    const decoder = new AlignmentDecoder(collectAlignmentLines(ALIGNMENT_LINES));
    expect(() => {
      if (failure !== "missing") decoder.push(JSON.stringify(value) + "\n");
      if (failure === "duplicate") decoder.push(JSON.stringify(value) + "\n");
      decoder.finish();
    }).toThrow();
  });
});
