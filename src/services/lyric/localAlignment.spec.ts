import { describe, expect, it } from "vitest";
import { parseLyric } from "lyric-kit";
import type { LyricLine, LyricSpan } from "@shared/types/lyrics";
import type { AlignmentLineResult } from "@shared/types/lyricAlignment";
import {
  alignRomanization,
  alignTranslation,
  type ReadingToken,
} from "@shared/testFixtures/legacyLyricAlignment";
import { applyTimedAuxiliary } from "@/utils/lyric/auxiliary";
import { createTranslationTrack } from "@/utils/lyric/translation";
import { applyGeneratedLyrics } from "@/utils/lyric/alignment";
import { applyLocalAlignment, collectLocalAlignmentLines } from "./localAlignment";

/** 构造跨汉字词与多声部共用的逐字歌词 */
const fixture = (): LyricLine => ({
  words: ["今", "日", "は", "晴", "れ"].map((word, index) => ({
    word,
    startTime: 1000 + index * 200,
    endTime: 1200 + index * 200,
  })),
  startTime: 1000,
  endTime: 2000,
  translatedLyric: "今天是晴天",
  romanLyric: "  Kyō  wa hare! ",
  isBG: true,
  isDuet: true,
});
const tokens: ReadingToken[] = [
  { text: "今日", reading: "kyou", from: 0, to: 1 },
  { text: "は", reading: "wa", from: 2, to: 2 },
  { text: "晴れ", reading: "hare", from: 3, to: 4 },
];

describe("现有音译的读音动态规划", () => {
  it("不把被规范化丢弃的其他文字误当成完全匹配的罗马音", () => {
    expect(alignRomanization(tokens, "kyou wa hare中文")).toBeNull();
    expect(alignRomanization(tokens, "kyou wa hareかな")).toBeNull();
  });
  it("跨汉字合并并保留长音、大小写、标点及所有空白", () => {
    const result = alignRomanization(tokens, fixture().romanLyric)!;
    expect(result.score).toBe(1);
    expect(result.parts).toEqual([
      { text: "  Kyō  ", from: 0, to: 1 },
      { text: "wa ", from: 2, to: 2 },
      { text: "hare! ", from: 3, to: 4 },
    ]);
  });
  it("连写音译也按候选读音切分，不依赖空格数", () => {
    expect(alignRomanization(tokens, "kyouwahare")!.parts.map((part) => part.text)).toEqual([
      "kyou",
      "wa",
      "hare",
    ]);
  });
  it("一个原词被分词器拆成多段时重新合并", () => {
    const source = [
      { text: "見", reading: "mi", from: 0, to: 0 },
      { text: "た", reading: "ta", from: 0, to: 0 },
      { text: "夢", reading: "yume", from: 1, to: 1 },
    ];
    expect(alignRomanization(source, "mita yume")!.parts).toEqual([
      { text: "mita ", from: 0, to: 0 },
      { text: "yume", from: 1, to: 1 },
    ]);
  });
  it("拒绝错误音译、遗漏短词、无法读取的汉字和超长输入", () => {
    expect(alignRomanization(tokens, "hello world")).toBeNull();
    expect(alignRomanization(tokens, "kyou hare")).toBeNull();
    expect(
      alignRomanization([{ text: "未知", reading: "未知", from: 0, to: 1 }], "michi"),
    ).toBeNull();
    expect(alignRomanization(tokens, "a".repeat(1025))).toBeNull();
  });
  it("跨空白统一罗马字体系，原始单个长音字符不能拆给两个时间片段", () => {
    const source = [
      { text: "こ", reading: "ko", from: 0, to: 0 },
      { text: "う", reading: "u", from: 1, to: 1 },
      { text: "し", reading: "shi", from: 2, to: 2 },
    ];
    expect(alignRomanization(source, "kō s h i")?.parts).toEqual([
      { text: "kō ", from: 0, to: 1 },
      { text: "s h i", from: 2, to: 2 },
    ]);
    expect(
      alignRomanization(
        [
          { text: "遠", reading: "too", from: 0, to: 0 },
          { text: "く", reading: "ku", from: 1, to: 1 },
        ],
        "Tō ku",
      )?.score,
    ).toBe(1);
  });
  it("词典外读音只定位到两侧强锚点夹住的单个原词，缺少短音节仍拒绝", () => {
    const source = [
      { text: "大", reading: "tai", from: 0, to: 0 },
      { text: "切", reading: "setsu", from: 1, to: 1 },
      { text: "な", reading: "na", from: 2, to: 2 },
      { text: "欠片", reading: "kakera", from: 3, to: 3 },
      { text: "だ", reading: "da", from: 4, to: 4 },
      { text: "と", reading: "to", from: 5, to: 5 },
      { text: "わかった", reading: "wakatta", from: 6, to: 6 },
    ];
    expect(
      alignRomanization(source, "ta i se tsu na ke ppe n da to wa ka 't ta")?.parts[3],
    ).toEqual({ text: "ke ppe n ", from: 3, to: 3 });
    expect(alignRomanization(source, "ta i se tsu na ke ppe n to wa ka 't ta")).toBeNull();
    expect(alignRomanization(source.slice(2), "na ke ppe n da to wa ka 't ta")).toBeNull();
    expect(alignRomanization(source, "ta i se tsu na hello world da to wa ka 't ta")).toBeNull();
  });
});

describe("已有译文的语义范围映射", () => {
  it("支持一对多并保留完整译文，不按字符重新分配原词时间", () => {
    const aligned = alignTranslation(
      tokens,
      ["今天", "是", "晴天"],
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
    )!;
    expect(aligned.parts).toEqual([
      { text: "今天", from: 0, to: 1 },
      { text: "是", from: 2, to: 2 },
      { text: "晴天", from: 3, to: 4 },
    ]);
  });
  it("语序倒置合并为短语，尾部仍保留独立锚点", () => {
    const aligned = alignTranslation(
      tokens,
      ["与你", "今天", "放晴"],
      [
        [1, 0],
        [0, 1],
        [2, 2],
      ],
    )!;
    expect(aligned.parts).toEqual([
      { text: "与你今天", from: 0, to: 2 },
      { text: "放晴", from: 3, to: 4 },
    ]);
  });
  it("覆盖不足或索引越界时不生成候选，完整倒序保留独立语义锚点", () => {
    expect(
      alignTranslation(
        tokens,
        ["今天", "无关联词", "晴天"],
        [
          [0, 0],
          [2, 2],
        ],
      ),
    ).toBeNull();
    expect(
      alignTranslation(
        tokens,
        ["晴天", "今天"],
        [
          [2, 0],
          [0, 1],
        ],
      ),
    ).toMatchObject({
      parts: [
        { text: "晴天", from: 3, to: 4 },
        { text: "今天", from: 0, to: 1 },
      ],
    });
    expect(alignTranslation(tokens, ["今天", "晴天"], [[99, 0]])).toBeNull();
  });
});

describe("本地对齐应用与重读", () => {
  it("算法候选与 AI 逐字生成复用相同的应用结果，包括词内音译", () => {
    const line = fixture();
    const romanization = alignRomanization(tokens, line.romanLyric)!;
    const local = applyLocalAlignment([line], [{ id: 0, romanization }]);
    const ai = applyGeneratedLyrics(
      [line],
      new Map([
        [
          0,
          {
            romanization: romanization.parts.map(({ from: index, to, text }) => ({
              index,
              to,
              text,
            })),
          },
        ],
      ]),
      { translation: false, romanization: false, wordTranslation: false, wordRomanization: true },
    );
    expect(ai).not.toBeNull();
    expect(local).toEqual(ai);
    expect(local![0].words.map((word) => word.romanWord)).toEqual([
      "Kyō",
      undefined,
      "wa",
      "hare!",
      undefined,
    ]);
  });
  it.each([false, true])("整行辅助时间不能冒充逐字对齐，重复时间片段=%s", (duplicate) => {
    const line = fixture();
    line.translationWords = (duplicate ? ["今天是", "晴天"] : [line.translatedLyric]).map(
      (word) => ({ word, startTime: line.startTime, endTime: line.endTime }),
    );
    line.romanizationWords = (duplicate ? ["  Kyō  ", "wa hare! "] : [line.romanLyric]).map(
      (word) => ({ word, startTime: line.startTime, endTime: line.endTime }),
    );
    expect(collectLocalAlignmentLines([line])).toEqual([
      {
        id: 0,
        words: line.words.map((word) => word.word),
        translation: line.translatedLyric,
        romanization: line.romanLyric,
      },
    ]);
    const updated = applyLocalAlignment(
      [line],
      [{ id: 0, romanization: alignRomanization(tokens, line.romanLyric)! }],
    )!;
    expect(updated[0].romanizationWords).toHaveLength(3);
    expect(updated[0].translationWords).toBe(line.translationWords);
  });
  it("每个原词都有音译仍需与整行文本一致，独立轨道的整行时间优先接受修复", () => {
    const line = fixture();
    line.translatedLyric = "";
    line.words = line.words.map((word) => ({ ...word, romanWord: line.romanLyric }));
    expect(collectLocalAlignmentLines([line])[0]?.romanization).toBe(line.romanLyric);
    line.words.forEach((word, index) => {
      word.romanWord = ["Ky", "ō", "wa", "ha", "re!"][index];
    });
    expect(collectLocalAlignmentLines([line])).toEqual([]);
    line.romanizationWords = [
      { word: line.romanLyric, startTime: line.startTime, endTime: line.endTime },
    ];
    expect(collectLocalAlignmentLines([line])[0]?.romanization).toBe(line.romanLyric);
  });
  it("混合逐行与逐字音译保存重读后，逐行内容继续进入默认待对齐列表", () => {
    const content = [
      "[00:01.000]<00:01.000>今<00:01.200>日<00:01.400>は<00:01.600>晴<00:01.800>れ<00:02.000>",
      "[00:03.000]<00:03.000>今<00:03.200>日<00:03.400>は<00:03.600>晴<00:03.800>れ<00:04.000>",
    ].join("\n");
    const original: LyricLine[] = parseLyric({ content, format: "lrc" }).lines;
    const aligned = [
      { word: "kyou ", startTime: 3000, endTime: 3400 },
      { word: "wa ", startTime: 3400, endTime: 3600 },
      { word: "hare", startTime: 3600, endTime: 4000 },
    ];
    const input = {
      content,
      format: "lrc" as const,
      romaji: createTranslationTrack(
        original,
        new Map<number, string | LyricSpan[]>([
          [0, "kyou wa hare"],
          [1, aligned],
        ]),
        "und-Latn",
        "normalized",
      ),
      romajiFormat: "ttml" as const,
    };
    const reloaded: LyricLine[] = parseLyric(input).lines;
    applyTimedAuxiliary(reloaded, input);
    expect(reloaded[0].romanizationWords).toHaveLength(1);
    expect(reloaded[1].romanizationWords).toEqual([
      { ...aligned[0], from: 0, to: 1 },
      aligned[1],
      { ...aligned[2], from: 3, to: 4 },
    ]);
    expect(
      collectLocalAlignmentLines(reloaded).map(({ id, romanization }) => ({ id, romanization })),
    ).toEqual([{ id: 0, romanization: "kyou wa hare" }]);
    const updated = applyLocalAlignment(reloaded, [
      { id: 0, romanization: alignRomanization(tokens, reloaded[0].romanLyric)! },
    ])!;
    expect(updated[0].romanizationWords).toHaveLength(3);
    expect(updated[1]).toBe(reloaded[1]);
  });
  it("显式重对齐可替换完整轨道，默认与未选择的轨道仍保留", () => {
    const line = fixture();
    line.translationWords = [
      { word: "今天是", startTime: 1000, endTime: 1800 },
      { word: "晴天", startTime: 1800, endTime: 2000 },
    ];
    line.romanizationWords = [
      { word: "  Kyō  wa ", startTime: 1000, endTime: 1800 },
      { word: "hare! ", startTime: 1800, endTime: 2000 },
    ];
    const snapshot = structuredClone(line);
    expect(collectLocalAlignmentLines([line])).toEqual([]);
    expect(collectLocalAlignmentLines([line], true)[0]).toMatchObject({
      translation: line.translatedLyric,
      romanization: line.romanLyric,
    });
    const result = {
      id: 0,
      translation: alignTranslation(
        tokens,
        ["今天", "是", "晴天"],
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      )!,
    };
    expect(applyLocalAlignment([line], [result])).toBeNull();
    const updated = applyLocalAlignment([line], [result], true)!;
    expect(updated[0].translationWords).toHaveLength(3);
    expect(updated[0].romanizationWords).toBe(line.romanizationWords);
    expect(updated[0].words).toBe(line.words);
    const both = applyLocalAlignment(
      [line],
      [{ ...result, romanization: alignRomanization(tokens, line.romanLyric)! }],
      true,
    )!;
    expect(both[0].romanizationWords).toHaveLength(3);
    expect(both[0].translatedLyric).toBe(line.translatedLyric);
    expect(both[0].romanLyric).toBe(line.romanLyric);
    expect(line).toEqual(snapshot);
  });
  it("仅处理真实逐字与已有文本，完整轨道保持不变", () => {
    const line = fixture();
    expect(collectLocalAlignmentLines([line])).toHaveLength(1);
    expect(
      collectLocalAlignmentLines([
        { ...line, words: [{ word: "今日は晴れ", startTime: 1000, endTime: 2000 }] },
      ]),
    ).toEqual([]);
    expect(collectLocalAlignmentLines([{ ...line, translatedLyric: "", romanLyric: "" }])).toEqual(
      [],
    );
    expect(
      collectLocalAlignmentLines([
        { ...line, words: line.words.map((word) => ({ ...word, startTime: 1000, endTime: 2000 })) },
      ]),
    ).toEqual([]);
  });
  it("部分成功不改写主词、另一辅助行与声部，辅助 TTML 重读保留时间", () => {
    const original = [
      fixture(),
      {
        ...fixture(),
        startTime: 3000,
        endTime: 4000,
        words: fixture().words.map((word) => ({
          ...word,
          startTime: word.startTime + 2000,
          endTime: word.endTime + 2000,
        })),
      },
    ];
    const before = structuredClone(original);
    const result: AlignmentLineResult = {
      id: 0,
      romanization: alignRomanization(tokens, original[0].romanLyric)!,
      translation: alignTranslation(
        tokens,
        ["今天", "是", "晴天"],
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
      )!,
    };
    const updated = applyLocalAlignment(original, [result])!;
    expect(original).toEqual(before);
    expect(updated[0].words.map(({ romanWord: _roman, ...word }) => word)).toEqual(
      original[0].words,
    );
    expect(updated[1]).toBe(original[1]);
    expect(updated[0].isBG).toBe(true);
    expect(updated[0].romanizationWords).toEqual([
      { word: "  Kyō  ", startTime: 1000, endTime: 1400, from: 0, to: 1 },
      { word: "wa ", startTime: 1400, endTime: 1600 },
      { word: "hare! ", startTime: 1600, endTime: 2000, from: 3, to: 4 },
    ]);
    const input = {
      content:
        "[00:01.000]<00:01.000>今<00:01.200>日<00:01.400>は<00:01.600>晴<00:01.800>れ<00:02.000>",
      format: "lrc" as const,
      romaji: createTranslationTrack(
        [{ ...updated[0], isBG: false, isDuet: false }],
        new Map([[0, updated[0].romanizationWords!]]),
        "und-Latn",
        "normalized",
      ),
      romajiFormat: "ttml" as const,
    };
    const reloaded: LyricLine[] = parseLyric(input).lines;
    applyTimedAuxiliary(reloaded, input);
    expect(
      reloaded[0].romanizationWords?.map(({ startTime, endTime }) => [startTime, endTime]),
    ).toEqual([
      [1000, 1400],
      [1400, 1600],
      [1600, 2000],
    ]);
  });
  it("拒绝文本改写、重复行、越界、低分及非递增映射", () => {
    const line = fixture();
    const result = { id: 0, romanization: alignRomanization(tokens, line.romanLyric)! };
    expect(applyLocalAlignment([line], [result, result])).toBeNull();
    expect(applyLocalAlignment([line], [{ ...result, id: 42 }])).toBeNull();
    expect(
      applyLocalAlignment(
        [line],
        [{ id: 0, romanization: { ...result.romanization, score: 0.4 } }],
      ),
    ).toBeNull();
    result.romanization.parts[0].text = "rewritten";
    expect(applyLocalAlignment([line], [result])).toBeNull();
  });
});
