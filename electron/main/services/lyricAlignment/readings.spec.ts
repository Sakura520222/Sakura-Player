import { createRequire } from "node:module";
import path from "node:path";
import kuromoji from "kuromoji";
import { beforeAll, describe, expect, it } from "vitest";
import type { AlignmentSourceLine } from "@shared/types/lyricAlignment";
import { alignRomanization } from "@shared/utils/lyricAlignment";
import { tokenizeAlignmentSource } from "./readings";

let tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  tokenizer = await new Promise((resolve, reject) => {
    kuromoji
      .builder({
        dicPath: path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict"),
      })
      .build((error, result) => (error ? reject(error) : resolve(result)));
  });
});

describe("按主歌词时间粒度匹配日语音译", () => {
  it("混合英文标题与人名的读音偏差局限于强锚点之间，不被长音候选挤走", () => {
    const line: AlignmentSourceLine = {
      id: 0,
      words: [
        "Re:Start ~",
        "君",
        "と",
        "ま",
        "た",
        "出",
        "逢",
        "え",
        "て",
        "~ - ",
        "神",
        "代",
        "あ",
        "み",
      ],
      readings: ["", "きみ", "", "", "", "で", "あ", "", "", "", "かみ", "しろ", "", ""],
      translation: "",
      romanization: "Re:Start ~ki mi to ma ta de a e te ~ - ka mi yo a mi ",
    };
    const result = alignRomanization(
      tokenizeAlignmentSource(line, tokenizer).phonetic,
      line.romanization,
    )!;
    expect(result).not.toBeNull();
    expect(result.parts.slice(-4)).toEqual([
      { text: "ka mi ", from: 10, to: 10 },
      { text: "yo ", from: 11, to: 11 },
      { text: "a ", from: 12, to: 12 },
      { text: "mi ", from: 13, to: 13 },
    ]);
  });
  it("假名单字与促音独立对齐，不把「いつも」放在第一个字下方", () => {
    const line: AlignmentSourceLine = {
      id: 0,
      words: [
        "い",
        "つ",
        "も",
        "笑",
        "っ",
        "て",
        "た",
        " ",
        "そ",
        "う",
        "見",
        "え",
        "て",
        "い",
        "た",
      ],
      readings: ["", "", "", "わら", "", "", "", "", "", "", "み", "", "", "", ""],
      translation: "",
      romanization: "i tsu mo wa ra 't te ta  so u mi e te i ta ",
    };
    const { source, phonetic } = tokenizeAlignmentSource(line, tokenizer);
    expect(source[0].text).toBe("いつも");
    const result = alignRomanization(phonetic, line.romanization)!;
    expect(result).not.toBeNull();
    expect(result.score).toBe(1);
    expect(result.parts.slice(0, 7)).toEqual([
      { text: "i ", from: 0, to: 0 },
      { text: "tsu ", from: 1, to: 1 },
      { text: "mo ", from: 2, to: 2 },
      { text: "wa ra ", from: 3, to: 3 },
      { text: "'t ", from: 4, to: 4 },
      { text: "te ", from: 5, to: 5 },
      { text: "ta  ", from: 6, to: 6 },
    ]);
    expect(result.parts.map((part) => part.text).join("")).toBe(line.romanization);
  });

  it.each([
    {
      words: ["辛", "く", "て", "苦", "い", "過", "去", "も"],
      readings: ["つら", "", "", "にが", "", "か", "こ", ""],
      romanization: "ka ra ku te ni ga i ka ko mo ",
    },
    {
      words: ["大", "切", "な", "欠片", "だ", "と", "わ", "か", "っ", "た"],
      readings: ["たい", "せつ", "", "かけら", "", "", "", "", "", ""],
      romanization: "ta i se tsu na ke ppe n da to wa ka 't ta ",
    },
    {
      words: ["一", "歩", "ず", "つ", "幸", "せ", "に", "向", "か", "っ", "て"],
      readings: ["いっ", "ぽ", "", "", "しあわ", "", "", "む", "", "", ""],
      romanization: "i ppo zu tsu shi a wa se ni mu ka 't te ",
    },
  ])("假名与词典候选读音共同恢复截图中的漏对齐：$romanization", (fixture) => {
    const line = { id: 0, translation: "", ...fixture };
    const { phonetic } = tokenizeAlignmentSource(line, tokenizer);
    const result = alignRomanization(phonetic, line.romanization)!;
    expect(result).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.parts.map((part) => part.text).join("")).toBe(line.romanization);
    expect(result.parts.map((part) => [part.from, part.to])).toEqual(
      line.words.map((_, index) => [index, index]),
    );
  });

  it("没有注音时仍拆开词尾假名，汉字复合词保留可证明的读音范围", () => {
    const line = {
      id: 0,
      words: ["今", "日", "は", "晴", "れ"],
      translation: "",
      romanization: "kyou wa hare",
    };
    const result = alignRomanization(
      tokenizeAlignmentSource(line, tokenizer).phonetic,
      line.romanization,
    )!;
    expect(result.parts).toEqual([
      { text: "kyou ", from: 0, to: 1 },
      { text: "wa ", from: 2, to: 2 },
      { text: "ha", from: 3, to: 3 },
      { text: "re", from: 4, to: 4 },
    ]);
  });
});
