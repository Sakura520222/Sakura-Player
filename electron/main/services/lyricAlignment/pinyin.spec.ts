import { describe, expect, it } from "vitest";
import { alignPinyin } from "./pinyin";

describe("现成中文拼音的精确匹配", () => {
  it.each([
    ["这可是我的角色歌", "zhè kě shì wǒ de jué sè gē"],
    ["街巷悠长，长不过喜乐未央", "jiē xiàng yōu cháng, cháng bú guò xǐ lè wèi yāng"],
    ["女绿律略hello", "nǚ lǜ lǜ lüè hello"],
    ["“我想起，”", "“wǒ xiǎng qǐ,”"],
  ])("保留声调、标点及原词时间范围：%s", (text, romanization) => {
    const words = Array.from(text);
    const result = alignPinyin({ id: 0, words, translation: "", romanization })!;
    expect(result).not.toBeNull();
    expect(result.parts.map((part) => part.text).join("")).toBe(romanization);
    expect(
      result.parts.flatMap((part) =>
        Array.from({ length: part.to - part.from + 1 }, (_, index) => part.from + index),
      ),
    ).toEqual(words.map((_, index) => index));
  });

  it("连写、词级主歌词和多音字沿用同一词典边界", () => {
    const result = alignPinyin({
      id: 0,
      words: ["音乐", "的", "快乐"],
      translation: "",
      romanization: "yīnyuè de kuàilè",
    });
    expect(result?.parts).toEqual([
      { text: "yīnyuè ", from: 0, to: 0 },
      { text: "de ", from: 1, to: 1 },
      { text: "kuàilè", from: 2, to: 2 },
    ]);
  });

  it("拒绝缺字、伪拼音、其他文字和日语，不把 u 与 ü 混为一音", () => {
    for (const romanization of ["wǒ qǐ", "hello world", "wǒ xiǎng qǐ中文", "wǒ xiǎng qǐかな"]) {
      expect(
        alignPinyin({ id: 0, words: ["我", "想", "起"], translation: "", romanization }),
      ).toBeNull();
    }
    expect(alignPinyin({ id: 0, words: ["女"], translation: "", romanization: "nu" })).toBeNull();
    expect(
      alignPinyin({ id: 0, words: ["君", "は"], translation: "", romanization: "kimi wa" }),
    ).toBeNull();
    expect(
      alignPinyin({ id: 0, words: ["我"], translation: "", romanization: "a".repeat(1025) }),
    ).toBeNull();
  });
});
