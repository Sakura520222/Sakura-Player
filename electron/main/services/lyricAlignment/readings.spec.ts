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
  it.each([
    ["ゆっくり歩き", "yu  ku li alu ki"],
    ["一緒に居ようよ", "i xiyo ni i yo u yo"],
    ["ふたりの時間が写ったphotograph", "fu ta li no ji kan ga wucu  ta photograph"],
    ["煌きがほら", "kilame ki ga ho la"],
    ["コントロールさせて", "ko n to ro o ru sa se te"],
    ["私のハート", "wa ta shi no ha to"],
    ["気づけた素直な思いへと", "ki du ke ta su na o na o mo i he to"],
    ["膨らんでくシフォンな想い", "fu ku ra n de ku shi fo n na o mo i"],
    ["“キマグレ”“自分勝手”", "“ ki ma gu re ”“ ji bu n ka 't te ”"],
    ["词：カサンドラ", "shi :ka sa n do ra"],
    ["2人を見守り続けて", "fu ta ri wo mi ma mo ri tsu zu ke te"],
    ["100人家族", "hya ku ni n ka zo ku"],
    ["わくわくするような未来の一歩目", "wa ku wa ku su ru yo u na mi ra i no i chi ho me"],
    ["私はいました誰にも見えず一人で", "wataxi wa i ma xi ta dare ni mo mi e zu hito li de"],
  ])("转写差异、长音和独立标点均保留完整原词范围：%s", (text, existing) => {
    const line = { id: 0, words: Array.from(text), translation: "", romanization: existing };
    const result = alignRomanization(tokenizeAlignmentSource(line, tokenizer).phonetic, existing)!;
    expect(result).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.parts.map((part) => part.text).join("")).toBe(existing);
    expect(
      result.parts.flatMap((part) =>
        Array.from({ length: part.to - part.from + 1 }, (_, index) => part.from + index),
      ),
    ).toEqual(line.words.map((_, index) => index));
  });

  it("数字注音沿用原字范围，重复词按实际字词范围拆分，英文拼写保持独立", () => {
    const numeric = {
      id: 0,
      words: ["２", "人", "の", "恋"],
      readings: ["ふた", "り", "", "こい"],
      translation: "",
      romanization: "fu ta ri no ko i",
    };
    const result = alignRomanization(
      tokenizeAlignmentSource(numeric, tokenizer).phonetic,
      numeric.romanization,
    )!;
    expect(result.parts[0]).toEqual({ text: "fu ta ", from: 0, to: 0 });
    const repeated = tokenizeAlignmentSource(
      { id: 0, words: Array.from("ひとつひとつが"), translation: "每一句每一句", romanization: "" },
      tokenizer,
    );
    expect(repeated.source.slice(0, 2).map(({ text, from, to }) => ({ text, from, to }))).toEqual([
      { text: "ひとつ", from: 0, to: 2 },
      { text: "ひとつ", from: 3, to: 5 },
    ]);
    const english = tokenizeAlignmentSource(
      { id: 0, words: ["君", "murmur"], translation: "", romanization: "" },
      tokenizer,
    );
    expect(english.source.filter((token) => token.text === "murmur")).toHaveLength(1);
    expect(
      alignRomanization([{ text: "river", reading: "river", from: 0, to: 0 }], "livel"),
    ).toBeNull();
  });

  it("整词词典补充行く的另一读音，未收录汉字必须有充分且唯一的上下文", () => {
    const line = { id: 0, words: ["行", "く"], translation: "", romanization: "yu ku" };
    expect(
      alignRomanization(tokenizeAlignmentSource(line, tokenizer).phonetic, line.romanization)
        ?.score,
    ).toBe(1);
    const source = [
      { text: "煌", reading: "煌", from: 0, to: 0 },
      ...["ki", "ga", "ho", "ra"].map((reading, index) => ({
        text: "かな",
        reading,
        from: index + 1,
        to: index + 1,
      })),
    ];
    expect(alignRomanization(source, "kilame ki ga ho ra")?.parts[0]).toEqual({
      text: "kilame ",
      from: 0,
      to: 0,
    });
    expect(alignRomanization(source.slice(0, 4), "kilame ki ga ho")).toBeNull();
    expect(alignRomanization(source, "unrelatedlongtext ki ga ho ra")).toBeNull();
    expect(
      alignRomanization(
        source.map((token, index) => (index ? token : { ...token, to: 1 })),
        "kilame ki ga ho ra",
      ),
    ).toBeNull();
  });

  it.each([
    ["こんな穏やかな君が来ることを", "konna odayaka na kimi ga kuru koto o"],
    ["自分の未来を描いてくこと", "jibun no mirai o egaiteku koto"],
    ["あきらめて出したを", "akiramete dashita o"],
    ["今を心に強くかみしめてる", "ima o kokoro ni tsuyoku kamishimeteru"],
    ["一緒で一度のめぐり合いを", "issho de ichido no meguriai o"],
    ["全てを悲してる", "subete o kanashiteru"],
    ["甘い日常を", "amai nichijou o"],
    ["愛しさと感謝の気持ちを", "itoshisa to kansha no kimochi o"],
    ["頑なだったねあの頃の私", "katakuna datta ne ano koro no watashi"],
    ["紙をかけるように", "kami o kakeru you ni"],
    ["もっと甘い甘い日常を", "motto amai amai nichijou o"],
    ["本当甘い甘い日常を", "hontou amai amai nichijou o"],
    ["手と手をつないで", "te to te o tsunaide"],
  ])("AI 音译的助词与连写词仍逐词对齐：%s", (text, romanization) => {
    for (const existing of [
      romanization,
      romanization.toUpperCase(),
      romanization.replace(/\s+/g, ""),
    ]) {
      const line = { id: 0, words: Array.from(text), translation: "", romanization: existing };
      const result = alignRomanization(
        tokenizeAlignmentSource(line, tokenizer).phonetic,
        existing,
      )!;
      expect(result).not.toBeNull();
      expect(result.score).toBeGreaterThanOrEqual(0.8);
      expect(result.parts.map((part) => part.text).join("")).toBe(existing);
      expect(
        result.parts.flatMap((part) =>
          Array.from({ length: part.to - part.from + 1 }, (_, index) => part.from + index),
        ),
      ).toEqual(line.words.map((_, index) => index));
      for (const [index, word] of line.words.entries()) {
        if (word !== "を") continue;
        const particle = result.parts.find((part) => part.from === index && part.to === index);
        expect(particle?.text.trim().toLowerCase()).toBe("o");
      }
    }
  });

  it("同一行的 wo 与 o 各自保留，不能把拉丁字母 wo 当成日语助词省略 w", () => {
    const line = {
      id: 0,
      words: ["君", "を", "信", "じ", "て", "僕", "を", "信", "じ", "て"],
      translation: "",
      romanization: "kimi o shinjite boku wo shinjite",
    };
    const result = alignRomanization(
      tokenizeAlignmentSource(line, tokenizer).phonetic,
      line.romanization,
    )!;
    expect(result).not.toBeNull();
    expect(
      result.parts.filter((part) => [1, 6].includes(part.from)).map((part) => part.text.trim()),
    ).toEqual(["o", "wo"]);
    const latin = { id: 0, words: ["wo"], translation: "", romanization: "o" };
    expect(
      alignRomanization(tokenizeAlignmentSource(latin, tokenizer).phonetic, latin.romanization),
    ).toBeNull();
  });
  it.each([
    {
      words: ["全", "て", "を", "悲", "し", "て", "る"],
      romanization: "su be te wo hi shi te ru",
      expected: ["su be ", "te ", "wo ", "hi ", "shi ", "te ", "ru"],
    },
    {
      words: ["幸", "せ", "悲", "し", "て", "る"],
      romanization: "shi a wa se hi shi te ru",
      expected: ["shi a wa ", "se ", "hi ", "shi ", "te ", "ru"],
    },
    {
      words: ["頑", "な", "だ", "っ", "た", "ね", "あ", "の", "頃", "の", "私"],
      romanization: "ga n na da tsu ta ne a no ko ro no wa ta ku shi",
      expected: [
        "ga n ",
        "na ",
        "da ",
        "tsu ",
        "ta ",
        "ne ",
        "a ",
        "no ",
        "ko ro ",
        "no ",
        "wa ta ku shi",
      ],
    },
    {
      words: ["心", "地", "良", "い"],
      romanization: "ko ko chi e i",
      expected: ["ko ko chi ", "e ", "i"],
    },
    {
      words: ["合", "わ", "せ", "た", "唇", "体", "中", "で"],
      romanization: "a wa se ta shi n ta i chu u de",
      expected: ["a ", "wa ", "se ", "ta ", "shi n ", "ta i ", "chu u ", "de"],
    },
    {
      words: ["喜", "び", "悲", "し", "て", "る"],
      romanization: "yo ro ko bi hi shi te ru",
      expected: ["yo ro ko ", "bi ", "hi ", "shi ", "te ", "ru"],
    },
  ])("已有音译采用不同汉字读法时仍沿用唯一的原词锚点：$romanization", (fixture) => {
    const line = { id: 0, translation: "", ...fixture };
    const snapshot = structuredClone(line);
    const result = alignRomanization(
      tokenizeAlignmentSource(line, tokenizer).phonetic,
      line.romanization,
    )!;
    expect(result).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.parts.map((part) => part.text)).toEqual(fixture.expected);
    expect(result.parts.map((part) => part.text).join("")).toBe(line.romanization);
    expect(
      result.parts.flatMap((part) =>
        Array.from({ length: part.to - part.from + 1 }, (_, index) => part.from + index),
      ),
    ).toEqual(line.words.map((_, index) => index));
    expect(line).toEqual(snapshot);
  });

  it("读音锚点不能掩盖缺少假名、多个错词、跨词未知读音或分组歧义", () => {
    const original = [
      { text: "全", reading: "sube", from: 0, to: 0 },
      { text: "て", reading: "te", from: 1, to: 1 },
      { text: "を", reading: "wo", from: 2, to: 2 },
      { text: "悲", reading: "kana", from: 3, to: 3 },
      { text: "し", reading: "shi", from: 4, to: 4 },
      { text: "て", reading: "te", from: 5, to: 5 },
      { text: "る", reading: "ru", from: 6, to: 6 },
    ];
    expect(alignRomanization(original, "su be te hi shi te ru")).toBeNull();
    expect(
      alignRomanization(
        [{ ...original[0], reading: "zen" }, ...original.slice(1)],
        "su be te wo hi shi te ru",
      ),
    ).toBeNull();
    expect(
      alignRomanization(
        original.map((word) => (word.text === "悲" ? { ...word, to: 4 } : word)),
        "su be te wo hi shi te ru",
      ),
    ).toBeNull();
    expect(
      alignRomanization(
        [
          { text: "君", reading: "kimi", from: 0, to: 0 },
          { text: "校", reading: "kou", readings: ["kou", "ko"], from: 1, to: 1 },
          { text: "字", reading: "ji", from: 2, to: 2 },
          { text: "歌", reading: "uta", readings: ["uta", "ta"], from: 3, to: 3 },
        ],
        "kimi ko u u ta",
      ),
    ).toBeNull();
  });
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
