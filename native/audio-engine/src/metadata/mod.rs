use std::collections::HashMap;

use ffmpeg_audio::SourceAudioInfo;

pub const LYRIC_DATA_KEY: &str = "SAKURA_PLAYER_LYRIC_DATA";

mod cover;
mod editor;
mod file_tags;
mod folder_cover;
mod lyric_data;
mod lyrics;
pub(crate) mod media_file;
mod tag_fields;

pub use cover::{
    cover_thumb_path, extract_cover_thumbnail, make_thumbnail_jpeg, read_attached_pic,
};
pub use editor::{read_cover, read_tags, write_tags, TagWriteRequest};
pub(crate) use file_tags::{read_summary, TrackTags};
pub use lyrics::{extract_embedded_lyric, find_all_external_lyrics, ExternalLyric};

/// 音频元数据（包含封面路径和歌词）
#[derive(Clone, Default)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// 注释/副标题
    pub comment: Option<String>,
    pub duration_secs: f64,
    /// 播放采样率（重采样后，用于音频输出）
    pub sample_rate: u32,
    /// 音源原始声道数
    pub channels: u16,
    /// 原始采样率（解码前，用于前端显示）
    pub original_sample_rate: u32,
    /// 位深（bits per sample）
    pub bits_per_sample: u32,
    /// 比特率（bps）
    pub bit_rate: i64,
    /// 编码格式名称（如 "flac", "mp3", "aac"）
    pub codec: String,
    pub decode_format: Option<String>,
    pub replay_gain_db: Option<f32>,
    pub artists: Vec<String>,
    pub album_artists: Vec<String>,
    /// 内嵌歌词
    pub embedded_lyric: Option<String>,
    pub embedded_lyric_data: Option<String>,
    /// 同目录所有歌词文件
    pub external_lyrics: Vec<ExternalLyric>,
    /// 封面缩略图缓存路径（用于前端日常显示）
    pub cover: Option<String>,
    /// 原始封面数据（load 时一次性提取，供 SMTC 等使用，避免重复打开文件）
    pub cover_raw: Option<Vec<u8>>,
}

/// 音频流基本参数（scanner 和 decoder 共用）
pub struct StreamInfo {
    pub bit_rate: i64,
    pub sample_rate: u32,
    pub bits_per_sample: u32,
    pub channels: u32,
}

/// 把 ffmpeg_audio 的 SourceAudioInfo 转成内部 StreamInfo
pub fn extract_stream_info(info: &SourceAudioInfo) -> StreamInfo {
    let effective_bits = info.sample_fmt.as_deref().is_some_and(|format| {
        matches!(
            format,
            "u8" | "u8p" | "s16" | "s16p" | "s32" | "s32p" | "s64" | "s64p"
        )
    }) && is_lossless_codec(info.codec_name.as_deref().unwrap_or_default());
    StreamInfo {
        bit_rate: info.bit_rate.max(0),
        sample_rate: info.sample_rate.max(0) as u32,
        bits_per_sample: if effective_bits {
            info.bits_per_sample.max(0) as u32
        } else {
            0
        },
        channels: info.channels.max(0) as u32,
    }
}

/// 大小写不敏感查找：原 ffmpeg-next 的 Dictionary::get 默认 case-insensitive，
/// 而 ffmpeg_audio 把 dict 转成普通 HashMap 后丢了这个语义，这里补回来
pub(crate) fn dict_get<'a>(dict: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    let target = tag_fields::normalize_tag_key(key);
    dict.iter()
        .find(|(k, _)| tag_fields::normalize_tag_key(k) == target)
        .map(|(_, v)| v.as_str())
}

/// 从容器 metadata 提取 ReplayGain / R128 增益值（dB）
///
/// 按优先级尝试：R128_TRACK_GAIN → replaygain_track_gain → album 版本
pub fn extract_replay_gain(dict: &HashMap<String, String>) -> Option<f32> {
    // EBU R128：值为 1/256 dB 单位的整数
    if let Some(val) =
        dict_get(dict, "R128_TRACK_GAIN").or_else(|| dict_get(dict, "R128_ALBUM_GAIN"))
    {
        if let Ok(raw) = val.trim().parse::<f32>() {
            if raw.is_finite() {
                return Some(raw / 256.0);
            }
        }
    }

    // ReplayGain：格式如 "-6.50 dB"
    if let Some(val) =
        dict_get(dict, "replaygain_track_gain").or_else(|| dict_get(dict, "replaygain_album_gain"))
    {
        let cleaned = val.trim().trim_end_matches(" dB").trim_end_matches("dB");
        if let Ok(db) = cleaned.parse::<f32>() {
            if db.is_finite() {
                return Some(db);
            }
        }
    }

    None
}

/// 使用解码器的编码描述识别无损，不按容器扩展名猜测
/// @param codec - FFmpeg 编码标识
pub(crate) fn is_lossless_codec(codec: &str) -> bool {
    let Ok(name) = std::ffi::CString::new(codec) else {
        return false;
    };
    unsafe {
        let descriptor = ffmpeg_audio::sys::avcodec_descriptor_get_by_name(name.as_ptr());
        !descriptor.is_null()
            && (*descriptor).props & ffmpeg_audio::sys::AV_CODEC_PROP_LOSSLESS as i32 != 0
            && (*descriptor).props & ffmpeg_audio::sys::AV_CODEC_PROP_LOSSY as i32 == 0
    }
}

/// 将 dB 增益转换为线性增益因子
pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
