import type { LyricFormat, LyricInput } from "../types/lyrics";

const sources: Array<[LyricFormat, string]> = [
  ["yrc", "[1234,3766](1234,766,0)逐(2100,900,0)字(3500,1500,0)歌词"],
  ["krc", "[offset:0]\n[1234,3766]<0,766,0>逐<866,900,0>字<2266,1500,0>歌词"],
  [
    "qrc",
    '<?xml version="1.0"?><QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[1234,3766]逐(1234,766)字(2100,900)歌词(3500,1500)"/></LyricInfo></QrcInfos>',
  ],
  ["lys", "[0]逐(1234,766)字(2100,900)歌词(3500,1500)"],
  [
    "ttml",
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1.234s" end="5s"><span begin="1.234s" end="2s">逐</span><span begin="2.1s" end="3s">字</span><span begin="3.5s" end="5s">歌词</span></p></div></body></tt>',
  ],
  ["lrc", "[00:01.234]<00:01.234>逐<00:02.000><00:02.100>字<00:03.000><00:03.500>歌词<00:05.000>"],
  [
    "ass",
    "[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.23,0:00:05.00,Default,,0,0,0,,{\\k77}逐{\\k90}字{\\k150}歌词",
  ],
  ["srt", "1\r\n00:00:01,234 --> 00:00:05,000\r\n逐字歌词\r\n"],
];

export const LYRIC_SAVE_FIXTURES: Array<LyricInput & { format: LyricFormat }> = sources.map(
  ([format, content]) => ({
    format,
    content,
    translation: "[00:01.234]翻译原文 & 标点",
    translationFormat: "lrc",
    romaji: "[00:01.234]zhu zi ge ci",
    romajiFormat: "lrc",
  }),
);
