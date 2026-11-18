//! 本地文件标签读写（lofty）
//!
//! 写入安全策略：复制原文件到同目录临时文件 → 修改临时文件 → 原子 rename 覆盖原文件。
//! Windows 下 std::fs::rename 使用 MOVEFILE_REPLACE_EXISTING，可覆盖已存在目标。
//!
//! 字段语义：
//! - `None` = 不修改该字段
//! - 文本字段 `Some("")` = 清除该标签项
//! - 数字字段 `Some(0)` = 清除该标签项
//! - 封面 `Some(bytes)` = 替换，`None` = 保留

use std::fs::{self, File, Metadata, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use anyhow::{Context, Result};
#[cfg(test)]
use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};
use parking_lot::Mutex;

use super::file_tags::{editing_tag_type, open_tagged, summarize, TrackTags};

/// 单文件写入请求
#[derive(Debug, Default)]
pub struct TagWriteRequest {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub lyrics: Option<String>,
    pub lyric_data: Option<String>,
    pub cover: Option<Vec<u8>>,
    pub artists: Option<Vec<String>>,
    pub album_artists: Option<Vec<String>>,
    pub genres: Option<Vec<String>>,
    pub composers: Option<Vec<String>>,
    pub date: Option<String>,
    pub comment: Option<String>,
    pub track_total: Option<u32>,
    pub disc_total: Option<u32>,
    pub remove_cover: bool,
    pub expected_revision: Option<String>,
}

/// 读取专辑大封面，优先内嵌正面图片，无图时沿用同目录封面规则
/// @param path - 本地音频文件路径
/// @returns 限制到 1200px 的 JPEG，不保留音频解码器或图片缓存
pub fn read_cover(path: &str) -> Result<Option<Vec<u8>>> {
    let tagged = open_tagged(Path::new(path), true).ok();
    let picture = tagged
        .as_ref()
        .into_iter()
        .flat_map(|tagged| tagged.tags())
        .flat_map(|tag| tag.pictures())
        .find(|pic| pic.pic_type() == PictureType::CoverFront)
        .or_else(|| {
            tagged
                .as_ref()?
                .tags()
                .iter()
                .find_map(|tag| tag.pictures().first())
        });
    let bytes = if let Some(picture) = picture {
        std::borrow::Cow::Borrowed(picture.data())
    } else if let Some(cover) = ffmpeg_audio::AudioReader::new(
        crate::decoder::input::AudioInput::new(fs::File::open(path)?)?,
    )
    .ok()
    .and_then(|reader| reader.cover())
    {
        std::borrow::Cow::Owned(cover.data)
    } else if let Some(cover) = super::folder_cover::find_folder_cover(path) {
        std::borrow::Cow::Owned(fs::read(cover)?)
    } else {
        return Ok(None);
    };
    let image = image::load_from_memory(&bytes)?;
    let image = if image.width() > 1200 || image.height() > 1200 {
        image.resize(1200, 1200, image::imageops::FilterType::Lanczos3)
    } else {
        image
    };
    let mut output = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 92)
        .encode_image(&image.to_rgb8())?;
    Ok(Some(output))
}

/// 读取可编辑字段和文件版本，解码专用格式返回只读快照
/// @param path - 本地音频文件路径
pub fn read_tags(path: &str) -> Result<TrackTags> {
    let file = Path::new(path);
    let attributes = fs::symlink_metadata(file)?;
    let revision = file_revision(&attributes)?;
    let mut tags = match open_tagged(file, true) {
        Ok(tagged) => {
            let mut tags = summarize(&tagged, true);
            if let Some(tag) = tagged
                .tag(editing_tag_type(tagged.file_type()))
                .or_else(|| tagged.primary_tag())
                .or_else(|| tagged.first_tag())
            {
                tags.lyric_data =
                    super::lyric_data::ContainerTag::open(file, tagged.file_type(), tag)?.data();
            }
            tags
        }
        Err(_) => {
            let reader = ffmpeg_audio::AudioReader::new(crate::decoder::input::AudioInput::new(
                fs::File::open(file)?,
            )?)?;
            let dict = reader.metadata();
            let mut tags = super::file_tags::from_ffmpeg(&dict);
            tags.lyrics = super::extract_embedded_lyric(&dict);
            tags.has_cover = reader.cover().is_some();
            tags
        }
    };
    tags.writable &= attributes.is_file() && !attributes.permissions().readonly();
    tags.revision = Some(revision);
    Ok(tags)
}

/// 从 tag 读取歌词，优先使用 ItemKey，回退时对未知/自定义 key 进行归一化匹配（如 "UNSYNCED LYRICS"）
pub(super) fn read_lyrics_from_tag(tag: &Tag) -> Option<String> {
    if let Some(lyrics) = tag
        .get_string(ItemKey::UnsyncLyrics)
        .or_else(|| tag.get_string(ItemKey::Lyrics))
    {
        return Some(lyrics.to_string());
    }

    // 遍历所有 items 寻找最优歌词标签
    tag.items()
        .filter_map(|item| {
            let key_str = format!("{:?}", item.key());
            let norm = super::tag_fields::normalize_tag_key(&key_str);
            if super::tag_fields::is_lyric_field_key(&norm) {
                if let Some(val) = item.value().text() {
                    if !val.is_empty() {
                        return Some((
                            val.to_string(),
                            super::tag_fields::get_lyric_priority(&norm),
                        ));
                    }
                }
            }
            None
        })
        .max_by_key(|(_, priority)| *priority)
        .map(|(val, _)| val)
}

/// 文本字段语义：None 不动，空串清除，非空覆盖
fn apply_text(tag: &mut Tag, key: ItemKey, value: &Option<String>) {
    match value {
        None => {}
        Some(text) if text.is_empty() => {
            tag.remove_key(key);
        }
        Some(text) => {
            tag.insert_text(key, text.clone());
        }
    }
}

/// 按容器标签写入独立值，避免把逗号、斜杠等名称字符当分隔符
/// @param tag - 准备保存的标签
/// @param key - 可多值字段
/// @param values - 新值列表，空列表清除
/// @param legacy - 旧版调用者传入的单值
fn apply_values(
    tag: &mut Tag,
    key: ItemKey,
    values: Option<&[String]>,
    legacy: &Option<String>,
) -> Result<()> {
    let Some(values) = values else {
        apply_text(tag, key, legacy);
        return Ok(());
    };
    tag.remove_key(key);
    for text in values {
        anyhow::ensure!(
            !text.is_empty() && !text.contains('\0'),
            "标签值为空或含有空字符"
        );
        anyhow::ensure!(
            tag.push(TagItem::new(key, ItemValue::Text(text.clone()))),
            "当前标签不支持该字段"
        );
    }
    Ok(())
}

/// 把写入请求应用到指定文件（直接修改该文件，调用方负责 temp + rename）
fn apply_to_file(path: &Path, request: &TagWriteRequest) -> Result<()> {
    let mut tagged = open_tagged(path, true)?;
    let tag_type = editing_tag_type(tagged.file_type());
    if tagged.tag(tag_type).is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }
    let original = super::lyric_data::ContainerTag::open(
        path,
        tagged.file_type(),
        tagged.tag(tag_type).expect("tag 必然存在"),
    )?;
    let retained_data = original.data();
    let tag = tagged.tag_mut(tag_type).expect("tag 必然存在");

    match request.title {
        None => {}
        Some(ref text) if text.is_empty() => tag.remove_title(),
        Some(ref text) => tag.set_title(text.clone()),
    }
    apply_values(
        tag,
        ItemKey::TrackArtist,
        request.artists.as_deref(),
        &request.artist,
    )?;
    match request.album {
        None => {}
        Some(ref text) if text.is_empty() => tag.remove_album(),
        Some(ref text) => tag.set_album(text.clone()),
    }
    apply_values(
        tag,
        ItemKey::Genre,
        request.genres.as_deref(),
        &request.genre,
    )?;
    apply_values(tag, ItemKey::Composer, request.composers.as_deref(), &None)?;
    apply_text(tag, ItemKey::Comment, &request.comment);
    match request.year {
        None => {}
        Some(0) => {
            tag.remove_key(ItemKey::Year);
            tag.remove_key(ItemKey::RecordingDate);
        }
        Some(year) => {
            tag.remove_key(ItemKey::Year);
            tag.insert_text(ItemKey::RecordingDate, year.to_string());
        }
    }
    match request.track_number {
        None => {}
        Some(0) => tag.remove_track(),
        Some(track) => tag.set_track(track),
    }
    match request.disc_number {
        None => {}
        Some(0) => tag.remove_disk(),
        Some(disk) => tag.set_disk(disk),
    }
    apply_values(
        tag,
        ItemKey::AlbumArtist,
        request.album_artists.as_deref(),
        &request.album_artist,
    )?;
    if request.date.is_some() {
        tag.remove_key(ItemKey::Year);
        apply_text(tag, ItemKey::RecordingDate, &request.date);
    }
    if let Some(total) = request.track_total {
        if total == 0 {
            tag.remove_track_total()
        } else {
            tag.set_track_total(total)
        }
    }
    if let Some(total) = request.disc_total {
        if total == 0 {
            tag.remove_disk_total()
        } else {
            tag.set_disk_total(total)
        }
    }
    // 替换时清掉两个旧字段，避免解码器优先读到旧 LYRICS；ID3v2 的文本歌词使用 USLT。
    if request.lyrics.is_some() {
        tag.remove_key(ItemKey::Lyrics);
        tag.remove_key(ItemKey::UnsyncLyrics);
        let key = if tag_type == TagType::Id3v2 {
            ItemKey::UnsyncLyrics
        } else {
            ItemKey::Lyrics
        };
        apply_text(tag, key, &request.lyrics);
    }

    if let Some(ref data) = request.cover {
        // from_reader 校验图片签名并识别 mime，非图片数据直接报错
        let mut picture = Picture::from_reader(&mut data.as_slice()).context("封面图片数据无效")?;
        picture.set_pic_type(PictureType::CoverFront);
        let had_front = tag
            .pictures()
            .iter()
            .any(|old| old.pic_type() == PictureType::CoverFront);
        tag.remove_picture_type(PictureType::CoverFront);
        if !had_front
            && tag
                .pictures()
                .first()
                .is_some_and(|old| old.pic_type() == PictureType::Other)
        {
            tag.remove_picture(0);
        }
        // FFmpeg 优先读取首张附图，将新正面封面放在保留下来的背面或插图前
        let retained: Vec<_> = (0..tag.pictures().len())
            .rev()
            .map(|index| tag.remove_picture(index))
            .collect();
        tag.push_picture(picture);
        for other in retained.into_iter().rev() {
            tag.push_picture(other);
        }
    } else if request.remove_cover {
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
    }

    let data = match request.lyrics.as_deref() {
        None => retained_data.as_deref(),
        Some("") => None,
        Some(_) => request.lyric_data.as_deref(),
    };
    let updated = std::mem::replace(tag, Tag::new(tag_type));
    original
        .write(path, updated, data, request.lyrics.is_some())
        .context("写入标签失败")?;
    Ok(())
}

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 生成同目录且进程内唯一的临时文件路径
fn temp_path(original: &Path) -> PathBuf {
    let mut name = original
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    name.push(format!(".{}.{}.tagedit.tmp", std::process::id(), sequence));
    original.with_file_name(name)
}

/// 文件长度及高精度时间用于拒绝覆盖已经变化的源文件
/// @param metadata - 打开文件得到的属性
fn file_revision(metadata: &Metadata) -> Result<String> {
    let modified = metadata.modified()?.duration_since(UNIX_EPOCH)?;
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{}:{}:{}",
            metadata.dev(),
            metadata.ino(),
            metadata.ctime(),
            metadata.ctime_nsec()
        )
    };
    #[cfg(not(unix))]
    let identity = metadata
        .created()?
        .duration_since(UNIX_EPOCH)?
        .as_nanos()
        .to_string();
    Ok(format!(
        "{}:{}:{identity}",
        metadata.len(),
        modified.as_nanos()
    ))
}

/// 重新读取临时文件，确认容器确实保存了本次请求的字段
/// @param path - 待验证的临时文件
/// @param request - 本次仅包含改动字段的写入请求
fn verify_edits(path: &Path, request: &TagWriteRequest) -> Result<()> {
    let tags = read_tags(path.to_str().context("临时文件路径无法编码")?)?;
    let text_fields = [
        ("标题", request.title.as_deref(), tags.title.as_deref()),
        ("专辑", request.album.as_deref(), tags.album.as_deref()),
        ("日期", request.date.as_deref(), tags.date.as_deref()),
        ("备注", request.comment.as_deref(), tags.comment.as_deref()),
        ("歌词", request.lyrics.as_deref(), tags.lyrics.as_deref()),
    ];
    for (label, wanted, actual) in text_fields {
        anyhow::ensure!(
            wanted.is_none_or(|value| value == actual.unwrap_or_default()),
            "容器未能保存标签字段：{label}"
        );
    }
    let multi_fields = [
        (
            "艺术家",
            request.artists.as_deref(),
            request.artist.as_deref(),
            &tags.artists,
        ),
        (
            "专辑艺术家",
            request.album_artists.as_deref(),
            request.album_artist.as_deref(),
            &tags.album_artists,
        ),
        (
            "流派",
            request.genres.as_deref(),
            request.genre.as_deref(),
            &tags.genres,
        ),
        (
            "作曲者",
            request.composers.as_deref(),
            None,
            &tags.composers,
        ),
    ];
    for (label, wanted, legacy, actual) in multi_fields {
        let matches = match (wanted, legacy) {
            (Some(values), _) => values == actual.as_slice(),
            (None, Some("")) => actual.is_empty(),
            (None, Some(value)) => actual.len() == 1 && actual[0] == value,
            (None, None) => true,
        };
        anyhow::ensure!(matches, "容器未能保存标签字段：{label}");
    }
    let counts = [
        (
            "年份",
            request.year.filter(|_| request.date.is_none()),
            tags.year,
        ),
        ("曲号", request.track_number, tags.track_number),
        ("曲目总数", request.track_total, tags.track_total),
        ("碟号", request.disc_number, tags.disc_number),
        ("碟片总数", request.disc_total, tags.disc_total),
    ];
    for (label, wanted, actual) in counts {
        anyhow::ensure!(
            wanted.is_none_or(|value| value == actual.unwrap_or(0)),
            "容器未能保存标签字段：{label}"
        );
    }
    if let Some(lyrics) = request.lyrics.as_deref() {
        let expected = request.lyric_data.as_deref().filter(|_| !lyrics.is_empty());
        anyhow::ensure!(
            tags.lyric_data.as_deref() == expected,
            "容器未能保存歌词辅助轨道"
        );
    }
    if request.cover.is_some() || request.remove_cover {
        anyhow::ensure!(
            tags.has_cover == request.cover.is_some(),
            "容器未能保存封面修改"
        );
    }
    Ok(())
}

static TAG_WRITER: Mutex<()> = Mutex::new(());

/// 在同目录暂存并核对编码包，校验通过后原子替换文件
/// @param request - 要保存的字段和可选的源文件版本
pub fn write_tags(request: &TagWriteRequest) -> Result<()> {
    let _writer = TAG_WRITER.lock();
    let original = Path::new(&request.path);
    let attributes = fs::symlink_metadata(original).context("读取原文件属性失败")?;
    anyhow::ensure!(
        attributes.is_file() && !attributes.permissions().readonly(),
        "源文件不可写或不是普通文件"
    );
    let revision = file_revision(&attributes)?;
    anyhow::ensure!(
        request
            .expected_revision
            .as_ref()
            .is_none_or(|expected| expected == &revision),
        "文件已经变化，请重新打开标签编辑器"
    );

    let temp = temp_path(original);
    let mut staged = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .context("无法创建同目录临时文件")?;
    let applied = (|| {
        let mut source = File::open(original)?;
        std::io::copy(&mut source, &mut staged).context("创建临时副本失败")?;
        drop(source);
        drop(staged);
        apply_to_file(&temp, request)?;
        verify_edits(&temp, request)?;
        super::media_file::verify_unchanged(original, &temp)?;
        let check = OpenOptions::new().write(true).open(&temp)?;
        check.set_permissions(attributes.permissions())?;
        check.sync_all()?;
        drop(check);
        anyhow::ensure!(
            file_revision(&fs::symlink_metadata(original)?)? == revision,
            "保存期间源文件已被修改"
        );
        fs::rename(&temp, original).context("覆盖原文件失败")
    })();
    if applied.is_err() {
        let _ = fs::remove_file(&temp);
    }
    applied
}

#[cfg(test)]
#[path = "tests/editor.rs"]
mod tests;
