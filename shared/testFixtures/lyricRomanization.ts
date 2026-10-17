import type { LyricLine } from "../types/lyrics";
import type { GeneratedLyric } from "../../src/services/lyric/aiGeneration";

export const ROMANIZATION_RANGE_LINE: LyricLine = {
  startTime: 1000,
  endTime: 3200,
  words: Array.from("愛しさと感謝の気持ちを").map((word, index) => ({
    word,
    startTime: 1000 + index * 200,
    endTime: 1200 + index * 200,
  })),
  translatedLyric: "珍惜与感谢的心情",
  romanLyric: "i to shi sa to ka n sha no ki mo chi wo",
  isBG: false,
  isDuet: false,
};

export const ROMANIZATION_RANGE_RESULT: GeneratedLyric = {
  romanization: [
    { index: 0, to: 1, text: "i to shi" },
    { index: 2, text: "sa" },
    { index: 3, text: "to" },
    { index: 4, to: 5, text: "ka n sha" },
    { index: 6, text: "no" },
    { index: 7, text: "ki" },
    { index: 8, to: 9, text: "mo chi" },
    { index: 10, text: "wo" },
  ],
};

export const ROMANIZATION_RANGE_OPTIONS = {
  translation: false,
  romanization: false,
  wordTranslation: false,
  wordRomanization: true,
};
