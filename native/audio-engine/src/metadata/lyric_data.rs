use super::tag_fields::{is_lyric_field_key, normalize_tag_key};
use super::LYRIC_DATA_KEY;
use anyhow::{bail, Result};
use lofty::ape::{ApeFile, ApeItem, ApeTag};
use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::{AudioFile, FileType};
use lofty::flac::FlacFile;
use lofty::id3::v2::{Frame, Id3v2Tag};
use lofty::mp4::{Atom, AtomData, AtomIdent, Ilst};
use lofty::musepack::MpcFile;
use lofty::ogg::{OggPictureStorage, OpusFile, SpeexFile, VorbisComments, VorbisFile};
use lofty::tag::{ItemValue, MergeTag, SplitTag, Tag, TagExt, TagType};
use lofty::wavpack::WavPackFile;
use std::{fs::File, path::Path};

/// Vorbis 与 APE 的通用 Tag 转换会丢弃自定义字段，保留原生标签余项后再合并编辑结果。
pub enum ContainerTag {
    Generic(Tag),
    Vorbis(VorbisComments),
    Ape(ApeTag),
}

impl ContainerTag {
    /// 保留通用标签模型无法表达的原生字段，避免编辑歌词时丢失其他自定义数据。
    pub fn open(path: &Path, file_type: FileType, generic: &Tag) -> Result<Self> {
        let options = ParseOptions::new().read_properties(false);
        let mut file = File::open(path)?;
        Ok(match file_type {
            FileType::Flac => {
                let mut value = FlacFile::read_from(&mut file, options)?;
                let mut tag = value.vorbis_comments().cloned().unwrap_or_default();
                for (picture, information) in value.remove_pictures() {
                    tag.insert_picture(picture, Some(information))?;
                }
                Self::Vorbis(tag)
            }
            FileType::Vorbis => Self::Vorbis(
                VorbisFile::read_from(&mut file, options)?
                    .vorbis_comments()
                    .clone(),
            ),
            FileType::Opus => Self::Vorbis(
                OpusFile::read_from(&mut file, options)?
                    .vorbis_comments()
                    .clone(),
            ),
            FileType::Speex => Self::Vorbis(
                SpeexFile::read_from(&mut file, options)?
                    .vorbis_comments()
                    .clone(),
            ),
            FileType::Ape => Self::Ape(
                ApeFile::read_from(&mut file, options)?
                    .ape()
                    .cloned()
                    .unwrap_or_default(),
            ),
            FileType::WavPack => Self::Ape(
                WavPackFile::read_from(&mut file, options)?
                    .ape()
                    .cloned()
                    .unwrap_or_default(),
            ),
            FileType::Mpc => Self::Ape(
                MpcFile::read_from(&mut file, options)?
                    .ape()
                    .cloned()
                    .unwrap_or_default(),
            ),
            _ => Self::Generic(generic.clone()),
        })
    }

    /// 读取独立存放的歌词格式与辅助轨道，不修改标准歌词字段。
    pub fn data(&self) -> Option<String> {
        match self {
            Self::Vorbis(tag) => tag.get(LYRIC_DATA_KEY).map(str::to_owned),
            Self::Ape(tag) => tag
                .get(LYRIC_DATA_KEY)
                .and_then(|item| item.value().text())
                .map(str::to_owned),
            Self::Generic(tag) => match tag.tag_type() {
                TagType::Id3v2 => Id3v2Tag::from(tag.clone())
                    .get_user_text(LYRIC_DATA_KEY)
                    .map(str::to_owned),
                TagType::Mp4Ilst => {
                    let tag = Ilst::from(tag.clone());
                    let key = AtomIdent::Freeform {
                        mean: "com.apple.iTunes".into(),
                        name: LYRIC_DATA_KEY.into(),
                    };
                    let data = tag.get(&key)?.data().find_map(|value| match value {
                        AtomData::UTF8(text) => Some(text.to_owned()),
                        _ => None,
                    });
                    data
                }
                _ => None,
            },
        }
    }

    /// 合并原生余项和编辑后的字段，写入调用方准备的临时音乐文件。
    pub fn write(
        self,
        path: &Path,
        mut updated: Tag,
        data: Option<&str>,
        replace_lyrics: bool,
    ) -> Result<()> {
        let options = WriteOptions::default();
        match self {
            Self::Vorbis(mut original) => {
                // Lofty 合并时把 ENCODER 消耗为 vendor；这两个原始字段都不属于本次编辑。
                let vendor = original.vendor().to_owned();
                let encoders: Vec<_> = original.get_all("ENCODER").map(str::to_owned).collect();
                // 通用标签合并会重算封面信息，未替换的图片及其原始描述单独保留。
                let mut pictures = Vec::new();
                for (picture, information) in original.remove_pictures() {
                    if let Some(index) = updated.pictures().iter().position(|item| item == &picture)
                    {
                        updated.remove_picture(index);
                        pictures.push((picture, information));
                    }
                }
                if replace_lyrics {
                    let keys: Vec<_> = original
                        .items()
                        .filter(|(key, _)| is_lyric_field_key(&normalize_tag_key(key)))
                        .map(|(key, _)| key.to_owned())
                        .collect();
                    for key in keys {
                        original.remove(&key).for_each(drop);
                    }
                }
                let mut value = original.split_tag().0.merge_tag(updated);
                for (picture, information) in pictures {
                    value.insert_picture(picture, Some(information))?;
                }
                value.set_vendor(vendor);
                value.remove("ENCODER").for_each(drop);
                for encoder in encoders {
                    value.push("ENCODER".to_string(), encoder);
                }
                value.remove(LYRIC_DATA_KEY).for_each(drop);
                if let Some(data) = data {
                    value.insert(LYRIC_DATA_KEY.to_string(), data.to_string());
                }
                value.save_to_path(path, options)?;
            }
            Self::Ape(mut original) => {
                if replace_lyrics {
                    let keys: Vec<_> = (&original)
                        .into_iter()
                        .filter(|item| is_lyric_field_key(&normalize_tag_key(item.key())))
                        .map(|item| item.key().to_owned())
                        .collect();
                    for key in keys {
                        original.remove(&key);
                    }
                }
                let mut value = original.split_tag().0.merge_tag(updated);
                value.remove(LYRIC_DATA_KEY);
                if let Some(data) = data {
                    value.insert(ApeItem::new(
                        LYRIC_DATA_KEY.to_string(),
                        ItemValue::Text(data.to_string()),
                    )?);
                }
                value.save_to_path(path, options)?;
            }
            Self::Generic(_) => match updated.tag_type() {
                TagType::Id3v2 => {
                    let mut value = Id3v2Tag::from(updated);
                    if replace_lyrics {
                        value.retain(|frame| !matches!(frame, Frame::UserText(text) if is_lyric_field_key(&normalize_tag_key(&text.description))));
                    }
                    value.remove_user_text(LYRIC_DATA_KEY);
                    if let Some(data) = data {
                        value.insert_user_text(LYRIC_DATA_KEY.to_string(), data.to_string());
                    }
                    value.save_to_path(path, options)?;
                }
                TagType::Mp4Ilst => {
                    let mut value = Ilst::from(updated);
                    if replace_lyrics {
                        value.retain(|atom| !matches!(atom.ident(), AtomIdent::Freeform { name, .. } if is_lyric_field_key(&normalize_tag_key(name))));
                    }
                    let key = AtomIdent::Freeform {
                        mean: "com.apple.iTunes".into(),
                        name: LYRIC_DATA_KEY.into(),
                    };
                    value.remove(&key).for_each(drop);
                    if let Some(data) = data {
                        value.insert(Atom::new(key, AtomData::UTF8(data.to_string())));
                    }
                    value.save_to_path(path, options)?;
                }
                _ if data.is_some() => bail!("该音频标签不支持保存完整歌词轨道"),
                _ => updated.save_to_path(path, options)?,
            },
        }
        Ok(())
    }
}
