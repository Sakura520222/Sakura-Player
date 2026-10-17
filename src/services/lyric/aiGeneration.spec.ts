import { describe, expect, it } from "vitest";
import { ALIGNMENT_LINES, ALIGNMENT_RESULT } from "@shared/testFixtures/lyricAlignment";
import { alignGeneratedLyrics } from "@/utils/lyric/alignment";
import {
  GENERATION_TASKS,
  collectGenerationLines,
  createGenerationMessages,
  createGenerationPlan,
  GenerationDecoder,
  getGenerationCoverage,
  type GeneratedLyric,
  type GenerationOptions,
} from "./aiGeneration";

const combinations = Array.from({ length: 15 }, (_, index) => ({
  mask: index + 1,
  options: Object.fromEntries(
    GENERATION_TASKS.map((key, bit) => [key, !!((index + 1) & (1 << bit))]),
  ) as GenerationOptions,
}));

describe("按选择生成辅助歌词", () => {
  it("反馈包含所有保留的历史错误及行号，仅发送诊断字段", () => {
    const source = collectGenerationLines(ALIGNMENT_LINES);
    const feedback = {
      lineId: null,
      message: "服务端错误",
      previousErrors: [
        { lineId: 25, message: "不得改写已有音译", rawResponse: "不得发送的原始响应" },
      ],
    };
    const messages = createGenerationMessages(
      source,
      combinations.at(-1)!.options,
      "zh-CN",
      { title: "原创", artists: [] },
      feedback,
    );
    expect(JSON.parse(messages[1].content).retryFeedback).toEqual({
      lineId: null,
      lineNumber: null,
      message: "服务端错误",
      previousErrors: [{ lineId: 25, lineNumber: 26, message: "不得改写已有音译" }],
    });
    expect(messages[1].content).not.toContain("不得发送的原始响应");
  });

  it("续译提示携带校验原因与稳定行号，错误内容仅作为有界数据传递", () => {
    const source = collectGenerationLines(ALIGNMENT_LINES);
    const options = combinations.at(-1)!.options;
    const feedback = {
      lineId: 25,
      message: "逐字对齐不得改写已有音译",
      rawResponse: "不得发送的完整响应",
    };
    const messages = createGenerationMessages(
      source,
      options,
      "zh-CN",
      { title: "原创", artists: [] },
      feedback,
    );
    expect(JSON.parse(messages[1].content).retryFeedback).toEqual({
      lineId: 25,
      lineNumber: 26,
      message: "逐字对齐不得改写已有音译",
    });
    expect(messages[0].content).toContain("retryFeedback");
    expect(messages[1].content).not.toContain(feedback.rawResponse);
    const unknownLine = createGenerationMessages(
      source,
      options,
      "en",
      { title: "原创", artists: [] },
      { lineId: null, message: "错误".repeat(1000) },
    );
    expect(JSON.parse(unknownLine[1].content).retryFeedback).toEqual({
      lineId: null,
      lineNumber: null,
      message: "错误".repeat(250),
    });
    expect(
      JSON.parse(
        createGenerationMessages(source, options, "en", { title: "原创", artists: [] })[1].content,
      ),
    ).not.toHaveProperty("retryFeedback");
  });

  it("兼容缩进数组且继续拒绝已有译文被改写、行号重复和逐字缺失", () => {
    const lines = structuredClone(ALIGNMENT_LINES);
    lines[0].translatedLyric = "Walk with you";
    const options = {
      translation: false,
      romanization: true,
      wordRomanization: true,
      wordTranslation: true,
    };
    const source = collectGenerationLines(lines);
    const decoder = new GenerationDecoder(source, options);
    const text = "```json\n" + JSON.stringify([{ id: 0, ...ALIGNMENT_RESULT }], null, 2) + "\n```";
    for (const character of text) decoder.push(character);
    expect(decoder.finish().get(0)).toEqual(ALIGNMENT_RESULT);
    for (const mutation of ["rewrite", "duplicate", "missing"] as const) {
      const value = { id: 0, ...structuredClone(ALIGNMENT_RESULT) };
      if (mutation === "rewrite") value.translation[0].text = "changed";
      if (mutation === "missing") value.romanization.pop();
      const rejected = new GenerationDecoder(source, options);
      expect(() => {
        rejected.push(JSON.stringify(mutation === "duplicate" ? [value, value] : [value], null, 2));
        rejected.finish();
      }).toThrow();
      expect(rejected.failedLineId).toBe(0);
    }
  });

  it("补齐模式跳过完整行，逐字任务复用已有文本并按行确定实际缺失项目", () => {
    const complete = alignGeneratedLyrics(ALIGNMENT_LINES, new Map([[0, ALIGNMENT_RESULT]]))![0];
    const source = [
      complete,
      {
        ...structuredClone(ALIGNMENT_LINES[0]),
        translatedLyric: "Walk with you",
        romanLyric: "kimi to aruku",
      },
      structuredClone(ALIGNMENT_LINES[0]),
    ];
    const before = structuredClone(source);
    const options = combinations.at(-1)!.options;
    const plan = createGenerationPlan(source, options, "missing");
    expect(plan.map((line) => line.id)).toEqual([1, 2]);
    expect(plan[0].options).toEqual({
      translation: false,
      romanization: false,
      wordTranslation: true,
      wordRomanization: true,
    });
    expect(plan[1].options).toEqual(options);
    const messages = createGenerationMessages([plan[0]], plan[0].options!, "zh-CN", {
      title: "原创",
      artists: [],
    });
    expect(JSON.parse(messages[1].content).lines[0]).toMatchObject({
      id: 1,
      existingTranslation: "Walk with you",
      existingRomanization: "kimi to aruku",
    });
    const textOnly = createGenerationPlan(
      source,
      {
        translation: true,
        romanization: false,
        wordTranslation: false,
        wordRomanization: false,
      },
      "missing",
    );
    expect(textOnly.map((line) => line.id)).toEqual([2]);
    expect(source).toEqual(before);
  });

  it("完整生成可从主歌词重做已有逐字内容，即使只勾选逐字项目", () => {
    const source = alignGeneratedLyrics(ALIGNMENT_LINES, new Map([[0, ALIGNMENT_RESULT]]))!;
    const options = {
      translation: false,
      romanization: false,
      wordTranslation: true,
      wordRomanization: true,
    };
    expect(createGenerationPlan(source, options, "missing")).toEqual([]);
    const plan = createGenerationPlan(source, options, "full");
    expect(plan.map((line) => line.id)).toEqual([0]);
    const messages = createGenerationMessages(plan, options, "en", { title: "原创", artists: [] });
    expect(messages[1].content).not.toContain("existingTranslation");
    expect(messages[1].content).not.toContain("existingRomanization");
    const decoder = new GenerationDecoder(plan, options);
    decoder.push(JSON.stringify({ id: 0, ...ALIGNMENT_RESULT }));
    expect(decoder.finish().size).toBe(1);
  });

  it("补齐混合轨道时忽略模型顺带生成的已有轨道，进度只接收本行缺失项目", () => {
    const source = structuredClone(ALIGNMENT_LINES);
    source[0].translatedLyric = "保留已有翻译";
    const options = {
      translation: true,
      romanization: true,
      wordTranslation: false,
      wordRomanization: false,
    };
    const plan = createGenerationPlan(source, options, "missing");
    const decoder = new GenerationDecoder(plan, options);
    decoder.push('{"id":0,"translation":"不得替换","romanization":"kimi"}\n');
    expect(decoder.finish().get(0)).toEqual({ romanization: "kimi" });
    const valid = new GenerationDecoder(plan, options);
    valid.push('{"id":0,"romanization":"kimi"}');
    expect(valid.finish().get(0)).toEqual({ romanization: "kimi" });
  });

  it.each(combinations)("组合 $mask 仅返回所选项目，逐字项可独立生成", ({ options }) => {
    const source = collectGenerationLines(ALIGNMENT_LINES);
    const value: GeneratedLyric = {};
    if (options.wordTranslation) value.translation = ALIGNMENT_RESULT.translation;
    else if (options.translation) value.translation = "Walk with you";
    if (options.wordRomanization) value.romanization = ALIGNMENT_RESULT.romanization;
    else if (options.romanization) value.romanization = "kimi to aruku";
    const decoder = new GenerationDecoder(source, options);
    for (const char of JSON.stringify({ id: 0, ...value })) decoder.push(char);
    expect(decoder.results.size).toBe(0);
    expect(decoder.finish().get(0)).toEqual(value);
    const messages = createGenerationMessages(source, options, "en", {
      title: "原创",
      artists: [],
    });
    const payload = JSON.parse(messages[1].content);
    expect(Object.keys(payload.lines[0])).toEqual(
      options.wordTranslation || options.wordRomanization ? ["id", "words"] : ["id", "text"],
    );
    expect(messages[1].content).not.toMatch(/startTime|endTime|ruby|path/);
    expect(messages[0].content.includes("Translation: return")).toBe(options.wordTranslation);
    expect(messages[0].content.includes("Romanization: return")).toBe(options.wordRomanization);
    expect(messages[0].content.includes("translation must be a nonempty single-line string")).toBe(
      options.translation && !options.wordTranslation,
    );
    expect(messages[0].content.includes("romanization must be a nonempty single-line string")).toBe(
      options.romanization && !options.wordRomanization,
    );
  });

  it("检测已有逐行、逐字和部分数据，不计入空主行且不修改歌词", () => {
    const aligned = alignGeneratedLyrics(ALIGNMENT_LINES, new Map([[0, ALIGNMENT_RESULT]]))![0];
    const source = [
      {
        ...structuredClone(ALIGNMENT_LINES[0]),
        translatedLyric: "旧译文",
        romanLyric: "old roman",
      },
      aligned,
      { ...structuredClone(ALIGNMENT_LINES[0]), words: [] },
    ];
    const before = structuredClone(source);
    expect(getGenerationCoverage(source)).toEqual({
      total: 2,
      existing: { translation: 2, romanization: 2, wordTranslation: 1, wordRomanization: 1 },
    });
    expect(source).toEqual(before);
    source[1].romanLyric = "";
    expect(collectGenerationLines(source)[1].existingRomanization).toBe("kimi to aruku");
    source[1].words[1].romanWord = undefined;
    source[1].romanizationWords = source[1].romanizationWords!.slice(0, 1);
    source[1].translationWords = source[1].translationWords!.slice(0, 1);
    expect(getGenerationCoverage(source)).toEqual({
      total: 2,
      existing: { translation: 2, romanization: 1, wordTranslation: 0, wordRomanization: 0 },
    });
  });

  it("只对齐已有文本时发送其内容，拒绝改写并保留原有标点与读音", () => {
    const lines = structuredClone(ALIGNMENT_LINES);
    lines[0].translatedLyric = "Walk with you";
    lines[0].romanLyric = "kimi to aruku";
    const source = collectGenerationLines(lines);
    const options = {
      translation: false,
      romanization: false,
      wordTranslation: true,
      wordRomanization: true,
    };
    const messages = createGenerationMessages(source, options, "zh-CN", {
      title: "原创",
      artists: [],
    });
    expect(JSON.parse(messages[1].content).lines[0]).toMatchObject({
      existingTranslation: "Walk with you",
      existingRomanization: "kimi to aruku",
    });
    const valid = new GenerationDecoder(source, options);
    valid.push(JSON.stringify({ id: 0, ...ALIGNMENT_RESULT }));
    expect(valid.finish().size).toBe(1);
    for (const field of ["translation", "romanization"] as const) {
      const value = structuredClone(ALIGNMENT_RESULT);
      value[field][0].text = "rewritten";
      const decoder = new GenerationDecoder(source, options);
      expect(() => {
        decoder.push(JSON.stringify({ id: 0, ...value }));
        decoder.finish();
      }).toThrow(/不得改写/);
    }
  });

  it("未勾选轨道不发送给模型，模型额外返回该轨道也不会写入或使所选项目失败", () => {
    const lines = structuredClone(ALIGNMENT_LINES);
    lines[0].translatedLyric = "不会发送的已有译文";
    lines[0].romanLyric = "will not send existing roman";
    const source = collectGenerationLines(lines);
    const options = {
      translation: false,
      romanization: true,
      wordTranslation: false,
      wordRomanization: false,
    };
    const messages = createGenerationMessages(source, options, "en", {
      title: "原创",
      artists: [],
    });
    expect(messages[1].content).not.toContain(lines[0].translatedLyric);
    expect(messages[1].content).not.toContain(lines[0].romanLyric);
    const decoder = new GenerationDecoder(source, options);
    decoder.push(JSON.stringify({ id: "0", translation: "extra", romanization: "kimi" }));
    expect(decoder.finish().get(0)).toEqual({ romanization: "kimi" });
  });

  it("逐字译文仅空格切分不同时恢复已有文本，音译范围保留原有读音", () => {
    const lines = structuredClone(ALIGNMENT_LINES);
    lines[0].translatedLyric = " Walk  with you ";
    lines[0].romanLyric = "kimi to aruku";
    const options = {
      translation: false,
      romanization: false,
      wordTranslation: true,
      wordRomanization: true,
    };
    const decoder = new GenerationDecoder(collectGenerationLines(lines), options);
    decoder.push(
      JSON.stringify({
        id: "0",
        translation: [
          { from: "2", to: "2", text: "Walk" },
          { from: "1", to: "1", text: " with " },
          { from: "0", to: "0", text: "you" },
        ],
        romanization: [{ from: "0", to: "2", text: "kimi to aruku" }],
      }),
    );
    expect(decoder.finish().get(0)).toEqual({
      translation: [
        { from: 2, to: 2, text: " Walk  " },
        { from: 1, to: 1, text: "with " },
        { from: 0, to: 0, text: "you " },
      ],
      romanization: [{ index: 0, to: 2, text: "kimi to aruku" }],
    });
  });

  it.each(combinations)("组合 $mask 兼容字符串行号并隔离未选择字段", ({ options }) => {
    const value = {
      id: "0",
      translation: options.wordTranslation ? ALIGNMENT_RESULT.translation : "Walk with you",
      romanization: options.wordRomanization ? ["kimi", "to", "aruku"] : "kimi to aruku",
      explanation: "额外说明不写入歌词",
    };
    const decoder = new GenerationDecoder(collectGenerationLines(ALIGNMENT_LINES), options);
    decoder.push(JSON.stringify([value], null, 2));
    const result = decoder.finish().get(0)!;
    expect(Object.keys(result)).toEqual([
      ...(options.translation || options.wordTranslation ? ["translation"] : []),
      ...(options.romanization || options.wordRomanization ? ["romanization"] : []),
    ]);
  });

  it("多项任务必须整行完整有效才记入续译进度", () => {
    const lines = [structuredClone(ALIGNMENT_LINES[0]), structuredClone(ALIGNMENT_LINES[0])];
    const options = {
      translation: true,
      romanization: true,
      wordTranslation: false,
      wordRomanization: false,
    };
    const decoder = new GenerationDecoder(collectGenerationLines(lines), options);
    expect(() =>
      decoder.push(
        '{"id":0,"translation":"已完成","romanization":"kimi"}\n{"id":1,"translation":"缺少音译"}\n',
      ),
    ).toThrow();
    expect(Array.from(decoder.results.keys())).toEqual([0]);
  });
});
