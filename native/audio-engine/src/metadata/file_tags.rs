use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use lofty::config::ParseOptions;
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag, TagType};

/// 文件标签快照，扫描只读取轻量字段
#[derive(Debug, Default, PartialEq)]
pub struct TrackTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub album_artists: Vec<String>,
    pub genre: Option<String>,
    pub genres: Vec<String>,
    pub composers: Vec<String>,
    pub comment: Option<String>,
    pub date: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub lyrics: Option<String>,
    pub lyric_data: Option<String>,
    pub has_cover: bool,
    pub writable: bool,
    pub revision: Option<String>,
}

/// WAV 主标签使用支持歌词和封面的 ID3v2 块
/// @param file_type - 实际文件格式
pub(super) fn editing_tag_type(file_type: FileType) -> TagType {
    match file_type {
        FileType::Wav => TagType::Id3v2,
        other => other.primary_tag_type(),
    }
}

/// 按文件内容识别标签容器，扫描时跳过图片与重复音频探测
/// @param path - 本地文件或无扩展名的临时副本
/// @param cover - 是否读取图像
pub(super) fn open_tagged(path: &Path, cover: bool) -> Result<TaggedFile> {
    Probe::open(path)
        .context("打开文件失败")?
        .guess_file_type()
        .context("识别文件格式失败")?
        .options(
            ParseOptions::new()
                .read_properties(false)
                .read_cover_art(cover),
        )
        .read()
        .context("解析音频标签失败")
}

/// 读取独立标签值，只拆分标签规范使用的空字符
/// @param tag - 当前优先级的标签
/// @param key - 字段键
fn values(tag: &Tag, key: ItemKey) -> Option<Vec<String>> {
    let fields: Vec<_> = tag
        .get_strings(key)
        .flat_map(|text| text.split('\0'))
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
        .collect();
    (!fields.is_empty()).then_some(fields)
}

/// 解析完整发行日期中的年份
/// @param date - 原始日期字符串
pub(super) fn year_from_date(date: &str) -> Option<u32> {
    date.get(..4)?.parse().ok().filter(|year| *year > 0)
}

/// 保留真实多值标签并补齐旧标签容器中的缺失字段
/// @param tagged - Lofty 解析结果
/// @param full - 是否读取歌词正文
pub(super) fn summarize(tagged: &TaggedFile, full: bool) -> TrackTags {
    let preferred = tagged.tag(editing_tag_type(tagged.file_type()));
    let primary = tagged.primary_tag();
    let ordered: Vec<_> = preferred
        .into_iter()
        .chain(primary.filter(|tag| Some(tag.tag_type()) != preferred.map(Tag::tag_type)))
        .chain(tagged.tags().iter().filter(|tag| {
            Some(tag.tag_type()) != preferred.map(Tag::tag_type)
                && Some(tag.tag_type()) != primary.map(Tag::tag_type)
        }))
        .collect();
    let text = |key| {
        ordered
            .iter()
            .find_map(|tag| tag.get_string(key))
            .map(str::to_owned)
    };
    let multi = |key| {
        ordered
            .iter()
            .find_map(|tag| values(tag, key))
            .unwrap_or_default()
    };
    let artists = multi(ItemKey::TrackArtist);
    let album_artists = multi(ItemKey::AlbumArtist);
    let genres = multi(ItemKey::Genre);
    let date = ordered
        .iter()
        .find_map(|tag| {
            tag.get_string(ItemKey::RecordingDate)
                .or_else(|| tag.get_string(ItemKey::Year))
        })
        .map(str::to_owned);
    TrackTags {
        title: text(ItemKey::TrackTitle),
        artist: artists.first().or_else(|| album_artists.first()).cloned(),
        artists,
        album: text(ItemKey::AlbumTitle),
        album_artist: album_artists.first().cloned(),
        album_artists,
        genre: genres.first().cloned(),
        genres,
        composers: multi(ItemKey::Composer),
        comment: text(ItemKey::Comment),
        year: date.as_deref().and_then(year_from_date),
        date,
        track_number: ordered.iter().find_map(|tag| tag.track()),
        track_total: ordered.iter().find_map(|tag| tag.track_total()),
        disc_number: ordered.iter().find_map(|tag| tag.disk()),
        disc_total: ordered.iter().find_map(|tag| tag.disk_total()),
        lyrics: full
            .then(|| {
                ordered
                    .iter()
                    .find_map(|tag| super::editor::read_lyrics_from_tag(tag))
            })
            .flatten(),
        has_cover: ordered.iter().any(|tag| !tag.pictures().is_empty()),
        writable: true,
        ..Default::default()
    }
}

/// 从 FFmpeg 标签补齐仅支持解码的格式或远程音源
/// @param dict - 流级与容器级标签
pub(super) fn from_ffmpeg(dict: &HashMap<String, String>) -> TrackTags {
    let read = |key| {
        super::dict_get(dict, key)
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    let number = |value: &str| value.trim().parse::<u32>().ok().filter(|n| *n > 0);
    let pair = |key| {
        let raw = super::dict_get(dict, key).unwrap_or_default();
        let (index, total) = raw.split_once('/').unwrap_or((raw, ""));
        (number(index), number(total))
    };
    let (track_number, track_total) = pair("track");
    let (disc_number, disc_total) = pair("disc");
    let date = read("date").or_else(|| read("year"));
    let album_artist = read("album_artist");
    TrackTags {
        title: read("title"),
        artist: read("artist").or_else(|| album_artist.clone()),
        album: read("album"),
        album_artist,
        genre: read("genre"),
        comment: read("comment"),
        year: date.as_deref().and_then(year_from_date),
        date,
        track_number,
        track_total: track_total.or_else(|| super::dict_get(dict, "tracktotal").and_then(number)),
        disc_number,
        disc_total: disc_total.or_else(|| super::dict_get(dict, "disctotal").and_then(number)),
        ..Default::default()
    }
}

/// 音源和曲库共用的标签优先级，优先读能够保留独立值的 Lofty 标签
/// @param source - 本地文件路径
/// @param dict - FFmpeg 读取的流级和容器级标签
pub(crate) fn read_summary(source: Option<&str>, dict: &HashMap<String, String>) -> TrackTags {
    let Some(tagged) = source.and_then(|source| open_tagged(Path::new(source), false).ok()) else {
        return from_ffmpeg(dict);
    };
    if tagged.tags().is_empty() {
        return from_ffmpeg(dict);
    }
    summarize(&tagged, false)
}
