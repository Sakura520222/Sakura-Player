import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types/player";
import {
  isValidHttpUrl,
  isValidJfjtLevel,
  mergeJfjtFallbackMetadata,
  normalizeJfjtFormat,
  normalizeJfjtLevel,
  normalizeNeteaseSongId,
  parseJfjtSize,
  parseJfjtSongResponse,
} from "@shared/utils/jfjt";

describe("JFJT 响应与字段校验", () => {
  it("校验标准嵌套 data 响应并提取全部可选字段", () => {
    const parsed = parseJfjtSongResponse({
      status: 200,
      data: {
        url: "https://m804.music.126.net/20261125/demo/song.flac",
        name: "晴天",
        ar_name: "周杰伦",
        al_name: "叶惠美",
        pic: "https://p2.music.126.net/cover.jpg",
        lyric: "[00:00.00]故事的小黄花",
        tlyric: "[00:00.00]Little yellow flower",
        size: "25.50MB",
        level: "lossless",
      },
    });
    expect(parsed).toEqual({
      url: "https://m804.music.126.net/20261125/demo/song.flac",
      rawLevel: "lossless",
      jfjtLevel: "lossless",
      size: Math.round(25.5 * 1024 * 1024),
      metadata: {
        name: "晴天",
        artistName: "周杰伦",
        albumName: "叶惠美",
        cover: "https://p2.music.126.net/cover.jpg",
        lyric: "[00:00.00]故事的小黄花",
        tlyric: "[00:00.00]Little yellow flower",
      },
    });
    // 未提供显式格式时不得按 level 猜测 format
    expect(parsed?.format).toBeUndefined();
  });

  it("兼容顶层平铺响应与仅含最小 url 字段的响应", () => {
    const parsed = parseJfjtSongResponse({
      status: 200,
      url: "https://cdn.example.com/audio/123",
      level: "极高音质",
      type: "mp3",
      size: 9830400,
    });
    expect(parsed).toEqual({
      url: "https://cdn.example.com/audio/123",
      rawLevel: "极高音质",
      jfjtLevel: "exhigh",
      format: "mp3",
      size: 9830400,
    });

    expect(parseJfjtSongResponse({ data: { url: "https://cdn.example.com/only-url" } })).toEqual({
      url: "https://cdn.example.com/only-url",
    });
  });

  it("拒绝非 200 状态、非法 data 形态与非 HTTP(S) 音频链接", () => {
    expect(parseJfjtSongResponse(null)).toBeNull();
    expect(parseJfjtSongResponse("invalid")).toBeNull();
    expect(parseJfjtSongResponse({ status: 400, data: { url: "https://a.com/1.mp3" } })).toBeNull();
    expect(parseJfjtSongResponse({ code: 403, data: { url: "https://a.com/1.mp3" } })).toBeNull();
    expect(parseJfjtSongResponse({ status: 200, data: null })).toBeNull();
    expect(parseJfjtSongResponse({ status: 200, data: [] })).toBeNull();
    expect(parseJfjtSongResponse({ status: 200, data: { url: "" } })).toBeNull();
    expect(parseJfjtSongResponse({ status: 200, data: { url: "javascript:alert(1)" } })).toBeNull();
    expect(parseJfjtSongResponse({ status: 200, data: { url: "file:///C:/a.mp3" } })).toBeNull();
    expect(parseJfjtSongResponse({ status: 200, data: { url: "/relative.mp3" } })).toBeNull();
  });

  it("忽略非法的封面地址但保留有效音频直链", () => {
    const parsed = parseJfjtSongResponse({
      status: 200,
      data: {
        url: "https://cdn.example.com/1.mp3",
        pic: "javascript:void(0)",
        name: "测试曲目",
      },
    });
    expect(parsed).toEqual({
      url: "https://cdn.example.com/1.mp3",
      metadata: { name: "测试曲目" },
    });
  });
});

describe("JFJT 体积、音质、格式与参数校验", () => {
  it("解析字节数与带单位体积字符串，非法值返回 undefined", () => {
    expect(parseJfjtSize(102400)).toBe(102400);
    expect(parseJfjtSize("102400")).toBe(102400);
    expect(parseJfjtSize("512B")).toBe(512);
    expect(parseJfjtSize("256 KB")).toBe(256 * 1024);
    expect(parseJfjtSize("9.81MB")).toBe(Math.round(9.81 * 1024 * 1024));
    expect(parseJfjtSize("1.5 GB")).toBe(Math.round(1.5 * 1024 * 1024 * 1024));
    expect(parseJfjtSize(0)).toBeUndefined();
    expect(parseJfjtSize("99999999999999999")).toBeUndefined();
    expect(parseJfjtSize(0.1)).toBeUndefined();
    expect(parseJfjtSize(-10)).toBeUndefined();
    expect(parseJfjtSize("unknown")).toBeUndefined();
    expect(parseJfjtSize("")).toBeUndefined();
  });

  it("归一化英文与中文音质标识，未识别值不猜测", () => {
    expect(normalizeJfjtLevel("standard")).toBe("standard");
    expect(normalizeJfjtLevel("标准音质")).toBe("standard");
    expect(normalizeJfjtLevel("较高音质")).toBe("higher");
    expect(normalizeJfjtLevel("exhigh")).toBe("exhigh");
    expect(normalizeJfjtLevel("极高音质")).toBe("exhigh");
    expect(normalizeJfjtLevel("lossless")).toBe("lossless");
    expect(normalizeJfjtLevel("无损音质")).toBe("lossless");
    expect(normalizeJfjtLevel("hires")).toBe("hires");
    expect(normalizeJfjtLevel("Hi-Res音质")).toBe("hires");
    expect(normalizeJfjtLevel("jyeffect")).toBe("jyeffect");
    expect(normalizeJfjtLevel("高清环绕声")).toBe("jyeffect");
    expect(normalizeJfjtLevel("sky")).toBe("sky");
    expect(normalizeJfjtLevel("沉浸环绕声")).toBe("sky");
    expect(normalizeJfjtLevel("jymaster")).toBe("jymaster");
    expect(normalizeJfjtLevel("超清母带")).toBe("jymaster");
    expect(normalizeJfjtLevel("constructor")).toBeUndefined();
    expect(normalizeJfjtLevel("mystery")).toBeUndefined();
  });

  it("仅接受纯数字网易云歌曲 ID 和允许的音质与格式", () => {
    expect(normalizeNeteaseSongId("186016")).toBe("186016");
    expect(normalizeNeteaseSongId(" 186016 ")).toBe("186016");
    expect(normalizeNeteaseSongId("https://music.163.com/song?id=186016")).toBeNull();
    expect(normalizeNeteaseSongId("abc123")).toBeNull();
    expect(normalizeNeteaseSongId("")).toBeNull();

    expect(isValidJfjtLevel("standard")).toBe(true);
    expect(isValidJfjtLevel("hires")).toBe(true);
    expect(isValidJfjtLevel("jymaster")).toBe(true);
    expect(isValidJfjtLevel("higher")).toBe(false);
    expect(isValidJfjtLevel("invalid")).toBe(false);

    expect(normalizeJfjtFormat(".FLAC")).toBe("flac");
    expect(normalizeJfjtFormat("mp3")).toBe("mp3");
    expect(normalizeJfjtFormat("exe")).toBeUndefined();
    expect(isValidHttpUrl("https://cdn.example.com/a.flac")).toBe(true);
    expect(isValidHttpUrl("https://cdn.example.com/a\n.flac")).toBe(false);
  });
});

describe("JFJT 元数据缺失兜底", () => {
  it("已有准确元数据时完全保留原对象，不覆盖现有字段", () => {
    const track: Track = {
      id: "186016",
      source: "netease",
      title: "晴天（官方标题）",
      artists: [{ id: "6452", name: "周杰伦" }],
      album: { id: "18905", name: "叶惠美", cover: "https://official/cover.jpg" },
      duration: 269000,
      cover: "https://official/cover.jpg",
      coverOriginal: "https://official/cover-1024.jpg",
    };
    const merged = mergeJfjtFallbackMetadata(track, {
      name: "晴天（第三方）",
      artistName: "Jay Chou",
      albumName: "Ye Hui Mei",
      cover: "https://jfjt/cover.jpg",
    });
    expect(merged).toBe(track);
  });

  it("仅补齐缺失的标题、歌手、专辑与封面", () => {
    const track: Track = {
      id: "186016",
      source: "netease",
      title: "",
      artists: [],
      duration: 269000,
    };
    const merged = mergeJfjtFallbackMetadata(track, {
      name: "晴天",
      artistName: "周杰伦 / 方文山",
      albumName: "叶惠美",
      cover: "https://jfjt/cover.jpg",
    });
    expect(merged.title).toBe("晴天");
    expect(merged.artists).toEqual([
      { id: "", name: "周杰伦" },
      { id: "", name: "方文山" },
    ]);
    expect(merged.album).toEqual({
      id: "",
      name: "叶惠美",
      cover: "https://jfjt/cover.jpg",
    });
    expect(merged.cover).toBe("https://jfjt/cover.jpg");
    expect(merged.coverOriginal).toBe("https://jfjt/cover.jpg");
  });
});
