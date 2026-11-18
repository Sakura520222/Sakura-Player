use super::{DecoderData, Shared};
use ffmpeg_audio::{AudioFrame, AudioSample, RawAudioData, SourceAudioInfo};

/// 可通过原位宽或更宽的整数容器无损传输的音源格式
#[derive(Clone, Copy, Debug, Default)]
pub struct IntegerPcmSpec {
    pub channels: u16,
    pub bits: u32,
}

impl IntegerPcmSpec {
    /// 只接受明确有效位深和标准单/双声道的本地无损整数 PCM
    /// @param info - FFmpeg 音源和解码器信息
    /// @param local - 是否由本地文件读取
    pub fn from_source(info: &SourceAudioInfo, local: bool) -> Option<Self> {
        if !local
            || info.sample_rate <= 0
            || !matches!(info.channels, 1 | 2)
            || !crate::metadata::is_lossless_codec(info.codec_name.as_deref().unwrap_or_default())
        {
            return None;
        }
        let max_bits = match info.sample_fmt.as_deref()? {
            "u8" | "u8p" => 8,
            "s16" | "s16p" => 16,
            "s32" | "s32p" => 32,
            _ => return None,
        };
        let bits = u32::try_from(info.bits_per_sample).ok()?;
        (1..=max_bits).contains(&bits).then_some(Self {
            channels: info.channels as u16,
            bits,
        })
    }
}

/// 将平面 PCM 按 FFmpeg 的声道顺序交错，并且只移动整数位
/// @param frame - 解码得到的原始帧
/// @param channels - 期望的声道数
/// @param buffer - 复用输出缓冲
/// @param align - 将原始位对齐到 i32 高位的转换
fn append<T: AudioSample>(
    frame: &AudioFrame<'_>,
    channels: usize,
    buffer: &mut Vec<i32>,
    align: impl Fn(T) -> i32,
) -> bool {
    match frame.raw_data::<T>() {
        Ok(RawAudioData::Packed(data)) if data.len() == frame.samples() * channels => {
            buffer.extend(data.iter().copied().map(align));
            true
        }
        Ok(RawAudioData::Planar(planes)) if planes.len() == channels => {
            buffer.reserve(frame.samples() * channels);
            for index in 0..frame.samples() {
                buffer.extend(planes.iter().map(|plane| align(plane[index])));
            }
            true
        }
        _ => false,
    }
}

/// 获取左对齐的整数样本，源采样率和声道保持原样
/// @param frame - FFmpeg 解码帧
/// @param format - FFmpeg 声明的原始解码采样格式
/// @param channels - 原始声道数
/// @param buffer - 待输出的交错样本
pub(crate) fn append_frame(
    frame: &AudioFrame<'_>,
    format: &str,
    channels: usize,
    buffer: &mut Vec<i32>,
) -> bool {
    match format {
        "u8" | "u8p" => append::<u8>(frame, channels, buffer, |sample| {
            (i32::from(sample) - 128) << 24
        }),
        "s16" | "s16p" => append::<i16>(frame, channels, buffer, |sample| i32::from(sample) << 16),
        "s32" | "s32p" => append::<i32>(frame, channels, buffer, |sample| sample),
        _ => false,
    }
}

/// 绕开重采样器、归一化和 DSP，将原始整数 PCM 直接发布给输出队列
/// @param data - 可复用的媒体解码器
/// @param shared - 本次独占流的队列
pub(super) fn decode(data: &mut DecoderData, shared: &Shared) {
    let format = data
        .reader
        .source_info()
        .sample_fmt
        .clone()
        .unwrap_or_default();
    let rate = f64::from(shared.sample_rate());
    let channels = usize::from(shared.channels());
    loop {
        if shared.is_stopping() {
            return;
        }
        let frame = match data.reader.receive_frame() {
            Ok(Some(frame)) => frame,
            Ok(None) | Err(ffmpeg_audio::AudioError::Eof) => return,
            Err(_) if shared.is_stopping() => return,
            Err(error) => {
                tracing::warn!(%error, "直通音频解码失败");
                shared.mark_pcm_invalid();
                shared.mark_decode_failed();
                return;
            }
        };
        let mut samples = shared.take_integer_buffer();
        let declared_frames = (frame.duration().as_secs_f64() * rate).round() as usize;
        if declared_frames != frame.samples()
            || !append_frame(&frame, &format, channels, &mut samples)
        {
            shared.mark_pcm_invalid();
            shared.mark_decode_failed();
            return;
        }
        if !samples.is_empty() {
            shared.push_integer(samples);
        }
    }
}
