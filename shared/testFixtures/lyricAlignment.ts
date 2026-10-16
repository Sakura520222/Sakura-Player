import type { LyricLine } from "../types/lyrics";

export const ALIGNMENT_LINES: LyricLine[] = [
  {
    id: "verse",
    agentId: "voice",
    startTime: 1000,
    endTime: 4500,
    words: [
      {
        word: "君",
        startTime: 1100,
        endTime: 1600,
        ruby: [{ word: "きみ", startTime: 1100, endTime: 1600 }],
      },
      { word: "と", startTime: 1700, endTime: 2000 },
      { word: "歩く", startTime: 2200, endTime: 4000 },
    ],
    translatedLyric: "",
    romanLyric: "",
    isBG: false,
    isDuet: false,
  },
];

export const ALIGNMENT_RESULT = {
  translation: [
    { text: "Walk ", from: 2, to: 2 },
    { text: "with ", from: 1, to: 1 },
    { text: "you", from: 0, to: 0 },
  ],
  romanization: [
    { index: 0, text: "kimi" },
    { index: 1, text: "to" },
    { index: 2, text: "aruku" },
  ],
};
