import { describe, expect, it } from "vitest";
import { ALIGNMENT_LINES, ALIGNMENT_RESULT } from "@shared/testFixtures/lyricAlignment";
import { AlignmentDecoder, collectAlignmentLines, createAlignmentMessages } from "./aiAlignment";

describe("智能翻译与音译逐字协议", () => {
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
