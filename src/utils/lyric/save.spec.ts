import { describe, expect, it } from "vitest";
import { parseLRC, parseLyric, parseTTML } from "lyric-kit";
import type { LyricLine } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { createLyricSaveContent } from "./save";
import { LYRIC_SAVE_FIXTURES } from "@shared/testFixtures/lyricSave";

const track: Track = {
  id: "123",
  source: "netease",
  title: '歌曲 & "标题"',
  artists: [{ id: "a", name: "歌手 & 合唱" }],
  duration: 30000,
};
const lines: LyricLine[] = [
  {
    startTime: 1234,
    endTime: 5000,
    words: [{ word: "歌词", startTime: 1234, endTime: 5000, romanWord: "ka shi" }],
    translatedLyric: "翻译",
    romanLyric: "",
    isBG: false,
    isDuet: false,
  },
];

describe("当前歌词保存内容", () => {
  it("逐行歌词仍使用普通 LRC，并保留翻译和音译且不修改显示数据", () => {
    const content = createLyricSaveContent(track, lines);
    expect(content.lrc).toBe("[00:01.234]歌词\n[00:01.234]翻译\n[00:01.234]ka shi");
    expect(content.ttml).toBeUndefined();
    expect(lines[0].romanLyric).toBe("");
    expect(createLyricSaveContent(track, [{ ...lines[0], isBG: true }]).lrc).toContain("(歌词)");
  });

  it.each(LYRIC_SAVE_FIXTURES.filter((input) => input.format !== "srt"))(
    "$format 导出 LRC 仍保留逐字起止时间与空拍",
    (raw) => {
      const input = parseLyric(raw).lines;
      const content = createLyricSaveContent(track, input);
      const reloaded = parseLyric({ format: "lrc", content: content.lrc }).lines;
      expect(input[0].words.length).toBeGreaterThan(1);
      expect(reloaded[0].words).toEqual(input[0].words);
      expect(reloaded[0].translatedLyric).toBe(input[0].translatedLyric);
      expect(reloaded[0].romanLyric).toBe(input[0].romanLyric);
    },
  );

  it("毫秒时间及只有音译时的字段位置能在保存后重新解析", () => {
    const content = createLyricSaveContent(track, [{ ...lines[0], translatedLyric: "" }]);
    const parsed = parseLRC(content.lrc);
    expect(parsed.lines[0].startTime).toBe(1234);
    expect(parsed.lines[0].translatedLyric).toBe("");
    expect(parsed.lines[0].romanLyric).toBe("ka shi");
  });

  it("给无元信息 TTML 补全歌曲匹配字段并保留逐字、翻译和制作者内容", () => {
    const original = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll"><head><metadata><amll:meta key="ttmlAuthorGithub" value="author"/></metadata></head><body><div><p begin="1.234s" end="5s"><span begin="1.234s" end="3s">歌</span><span begin="3s" end="5s">词</span><span ttm:role="x-translation" xml:lang="zh-CN">翻译</span></p></div></body></tt>`;
    const originalLines = parseTTML(original).lines;
    const content = createLyricSaveContent(track, originalLines, original);
    const parsed = parseTTML(content.ttml!);
    expect(parsed.lines).toEqual(parseTTML(original).lines);
    expect(parseLRC(content.lrc).lines[0].words).toEqual(originalLines[0].words);
    expect(content.ttml).toContain('key="ncmMusicId" value="123"');
    expect(content.ttml).toContain('key="ttmlAuthorGithub" value="author"');
    const doc = new DOMParser().parseFromString(content.ttml!, "application/xml");
    const meta = Array.from(doc.getElementsByTagName("amll:meta"));
    expect(
      meta.find((node) => node.getAttribute("key") === "musicName")?.getAttribute("value"),
    ).toBe(track.title);
    expect(meta.find((node) => node.getAttribute("key") === "artists")?.getAttribute("value")).toBe(
      track.artists[0].name,
    );
  });
});
