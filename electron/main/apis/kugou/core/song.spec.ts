import { describe, expect, it, vi } from "vitest";

vi.mock("@main/store", () => ({ store: { get: vi.fn() } }));

import { normalizeKGSong } from "./song";

describe("KG 列表歌曲元数据", () => {
  it("保留结构化歌手和专辑身份，不拆分歌手名称", () => {
    const song = normalizeKGSong({
      base: { audio_id: 12, album_audio_id: 34, album_id: "56", audio_name: "歌曲" },
      audio_info: { hash: "hash", duration: 123456 },
      authors: [
        { author_id: 78, author_name: "AC/DC" },
        { author_id: 90, author_name: "歌手" },
      ],
      album_info: { album_name: "专辑", cover: "https://example.com/{size}/cover.jpg" },
    });
    expect(song).toMatchObject({
      id: "12",
      audioId: 12,
      albumAudioId: 34,
      albumId: "56",
      album: "专辑",
      artists: [
        { id: 78, name: "AC/DC" },
        { id: 90, name: "歌手" },
      ],
      duration: 123456,
      interval: 123.456,
      cover: "https://example.com/300/cover.jpg",
      coverOriginal: "https://example.com/480/cover.jpg",
    });
  });

  it("不足十秒的歌曲仍使用毫秒时长", () => {
    expect(normalizeKGSong({ audio_info: { timelength: 8000 } })).toMatchObject({
      duration: 8000,
      interval: 8,
    });
  });

  it("保留全部可用音质和付费字段", () => {
    const song = normalizeKGSong({
      audio_info: {
        hash_128: "a",
        filesize_128: 1,
        hash_320: "b",
        filesize_320: 2,
        hash_flac: "c",
        filesize_flac: 3,
        hash_high: "d",
        filesize_high: 4,
      },
      deprecated: { pay_type: 1, feetype: 2, pkg_price: 3, price: 4 },
      copyright: { privilege: 5 },
    });
    expect(song.qualities).toEqual(["128k", "320k", "flac", "flac24bit"]);
    expect(song.hashes).toEqual({ "128k": "a", "320k": "b", flac: "c", flac24bit: "d" });
    expect(song.sizes).toEqual({ "128k": 1, "320k": 2, flac: 3, flac24bit: 4 });
    expect(song.pay).toEqual({ payplay: 1, feetype: 2, pkg_price: 3, price: 4, privilege: 5 });
  });

  it("单曲缺少专辑信息时保留集合提供的专辑和封面", () => {
    const song = normalizeKGSong(
      { base: { album_id: 0 } },
      {
        albumId: "42",
        albumName: "专辑",
        cover: "https://example.com/{size}.jpg",
      },
    );
    expect(song).toMatchObject({
      albumId: "42",
      album: "专辑",
      cover: "https://example.com/300.jpg",
    });
  });
});
