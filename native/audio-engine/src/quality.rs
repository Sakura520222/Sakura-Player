use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use anyhow::{ensure, Result};
use ffmpeg_audio::{sys::AVERROR_INVALIDDATA, AudioError, AudioReader, ResampleOptions, SeekMode};
use rustfft::{num_complex::Complex32, FftPlanner};

use crate::decoder::direct::append_frame;
use crate::decoder::input::AudioInput;
use crate::metadata::{self, media_file::ContainerDetails};

const FFT_SIZE: usize = 4096;
const BANDS: usize = 128;
const WINDOW_SECONDS: f64 = 3.0;

/// 读取本地文件的原始格式，保留源容器与解码器参数的区别
pub(crate) struct FileQuality {
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub valid_bits: u32,
    pub decoded_format: Option<String>,
    pub is_lossless: bool,
    pub container: Option<ContainerDetails>,
    pub replay_gain_track_db: Option<f32>,
    pub replay_gain_album_db: Option<f32>,
    pub replay_gain_track_peak: Option<f32>,
    pub replay_gain_album_peak: Option<f32>,
    pub r128_track_gain_db: Option<f32>,
    pub r128_album_gain_db: Option<f32>,
}

/// 在本地文件旁路读取编码、章节和增益标签
/// @param path - 实际加载的实体音频文件
pub(crate) fn inspect(path: &Path) -> Result<FileQuality> {
    let reader = AudioReader::new(AudioInput::new(File::open(path)?)?)?;
    let source = reader.source_info();
    let stream = metadata::extract_stream_info(source);
    let codec = source.codec_name.clone().unwrap_or_default();
    let tags = reader.metadata();
    let number = |key| {
        metadata::dict_get(&tags, key).and_then(|value| {
            let text = value
                .trim()
                .strip_suffix("dB")
                .or_else(|| value.trim().strip_suffix("db"))
                .unwrap_or(value)
                .trim();
            text.parse::<f32>().ok().filter(|value| value.is_finite())
        })
    };
    Ok(FileQuality {
        is_lossless: metadata::is_lossless_codec(&codec),
        codec,
        sample_rate: stream.sample_rate,
        channels: stream.channels,
        valid_bits: stream.bits_per_sample,
        decoded_format: source.sample_fmt.clone(),
        container: metadata::media_file::inspect(path).ok(),
        replay_gain_track_db: number("replaygain_track_gain"),
        replay_gain_album_db: number("replaygain_album_gain"),
        replay_gain_track_peak: number("replaygain_track_peak").filter(|value| *value > 0.0),
        replay_gain_album_peak: number("replaygain_album_peak").filter(|value| *value > 0.0),
        r128_track_gain_db: number("r128_track_gain").map(|gain| gain / 256.0),
        r128_album_gain_db: number("r128_album_gain").map(|gain| gain / 256.0),
    })
}

/// 有界旁路解码得到的源频谱和疑似截止证据
pub(crate) struct Spectrum {
    pub nyquist_hz: f64,
    pub relative_bands_db: Vec<f64>,
    pub analyzed_seconds: f64,
    pub observed_integer_bits: Option<u32>,
    pub cutoff_hz: Option<f64>,
    pub windows: u32,
    pub partial: bool,
}

/// 检查高频能量是否在一小段频带内持续突降
/// @param spectrum - 单个片段的声道功率之和
/// @param rate - 源采样率
fn cutoff(spectrum: &[f64], rate: u32) -> Option<f64> {
    let hz_per_bin = f64::from(rate) / FFT_SIZE as f64;
    let peak = spectrum.iter().copied().fold(0.0, f64::max);
    let bins = |hz: f64| (hz / hz_per_bin).round() as usize;
    let average = |start: f64, end: f64| {
        let band = &spectrum[bins(start)..bins(end)];
        band.iter().sum::<f64>() / band.len() as f64
    };
    let mut strongest = 1_000.0;
    let mut result = None;
    let limit = (f64::from(rate) / 2.0 - 2_500.0).min(23_500.0) as usize;
    for center in (13_500..=limit).step_by(125) {
        let center = center as f64;
        let low = average(center - 1_000.0, center - 250.0);
        let high = average(center + 250.0, center + 2_000.0);
        let tail = &spectrum[bins(center + 1_000.0)..];
        if low > peak * 0.0001
            && high * strongest < low
            && tail.iter().copied().fold(0.0, f64::max) < low * 0.05
        {
            strongest = low / high.max(f64::MIN_POSITIVE);
            result = Some(center);
        }
    }
    result
}

/// 只分析分散的短片段，保持原采样率且按声道独立计算谱能量
/// @param path - 本地文件路径
/// @param start - 曲目在文件中的起点，秒
/// @param end - CUE 曲目终点，秒
/// @param canceled - 界面离开后立即置位
pub(crate) fn analyze(
    path: &Path,
    start: f64,
    end: Option<f64>,
    canceled: &AtomicBool,
) -> Result<Spectrum> {
    ensure!(!canceled.load(Ordering::Relaxed), "音质分析已取消");
    ensure!(
        start.is_finite()
            && start >= 0.0
            && end.is_none_or(|time| time.is_finite() && time > start),
        "分析区间无效"
    );
    let mut reader = AudioReader::new(AudioInput::new(File::open(path)?)?)?;
    let source = reader.source_info();
    let rate = u32::try_from(source.sample_rate)?;
    let channels = usize::try_from(source.channels)?;
    ensure!(
        rate > 0 && rate <= 768_000 && (1..=32).contains(&channels),
        "当前音频规格不支持频谱分析"
    );
    let decoded_format = source.sample_fmt.clone().unwrap_or_default();
    let is_lossless = metadata::is_lossless_codec(source.codec_name.as_deref().unwrap_or_default());
    let duration = reader
        .duration()
        .map(|value| value.as_secs_f64())
        .unwrap_or(start + 3.0 * WINDOW_SECONDS);
    let end = end.unwrap_or(duration).min(duration);
    ensure!(end > start, "音源没有可分析的区间");
    let length = ((end - start) / 3.0).min(WINDOW_SECONDS);
    let starts = [start, (start + end - length) * 0.5, end - length];
    let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / FFT_SIZE as f32).cos())
        .collect();
    let mut scratch = vec![Complex32::default(); fft.get_inplace_scratch_len()];
    let mut bins = vec![Complex32::default(); FFT_SIZE];
    let mut block = Vec::<f32>::with_capacity(FFT_SIZE * channels);
    let mut integer = Vec::<i32>::new();
    let mut observed = 0u32;
    let mut observed_all = true;
    let mut converter = reader.build_resampler(ResampleOptions::new().format::<f32>())?;
    let mut total = vec![0.0; FFT_SIZE / 2 + 1];
    let mut windows = 0;
    let mut cutoffs = Vec::new();
    let mut analyzed_frames = 0usize;
    let mut partial = false;
    let mut invalid_frame = None;
    for scan_start in starts {
        if scan_start > 0.0
            && reader
                .seek(Duration::from_secs_f64(scan_start), SeekMode::Accurate)
                .is_err()
        {
            partial = true;
            continue;
        }
        converter.flush()?;
        block.clear();
        let mut remaining = (length * f64::from(rate)).floor() as usize * channels;
        let mut power = vec![0.0; FFT_SIZE / 2 + 1];
        let mut blocks = 0;
        while remaining > 0 {
            ensure!(!canceled.load(Ordering::Relaxed), "音质分析已取消");
            let frame = match reader.receive_frame() {
                Ok(Some(frame)) => frame,
                Ok(None) | Err(AudioError::Eof) => break,
                Err(error @ AudioError::FFmpeg(AVERROR_INVALIDDATA, _)) => {
                    // 损坏的帧只中断当前片段，已经解码的采样仍可用于绘图
                    partial = true;
                    invalid_frame.get_or_insert(error);
                    break;
                }
                Err(error) => return Err(error.into()),
            };
            converter.process::<f32>(Some(&frame))?;
            let samples = converter.output_as::<f32>();
            let count = remaining.min(samples.len());
            remaining -= count;
            analyzed_frames += count / channels;
            if observed_all && is_lossless {
                integer.clear();
                observed_all = append_frame(&frame, &decoded_format, channels, &mut integer);
                for &sample in integer.iter().take(count) {
                    observed |= sample as u32;
                }
            }
            let mut audio = &samples[..count];
            while !audio.is_empty() {
                let (chunk, rest) =
                    audio.split_at(audio.len().min(FFT_SIZE * channels - block.len()));
                block.extend_from_slice(chunk);
                audio = rest;
                if block.len() < FFT_SIZE * channels {
                    continue;
                }
                let energy = block
                    .iter()
                    .map(|sample| f64::from(*sample).powi(2))
                    .sum::<f64>()
                    / block.len() as f64;
                if energy.is_finite() && energy > 1.0e-8 {
                    blocks += 1;
                    for channel in 0..channels {
                        for (i, bin) in bins.iter_mut().enumerate() {
                            *bin = Complex32::new(block[i * channels + channel] * window[i], 0.0);
                        }
                        fft.process_with_scratch(&mut bins, &mut scratch);
                        for (value, bin) in power.iter_mut().zip(&bins) {
                            *value += f64::from(bin.norm_sqr());
                        }
                    }
                }
                block.clear();
            }
        }
        if blocks >= 4 {
            windows += 1;
            if let Some(hz) = cutoff(&power, rate) {
                cutoffs.push(hz);
            }
            for (sum, value) in total.iter_mut().zip(power) {
                *sum += value;
            }
        }
    }
    if partial && analyzed_frames == 0 {
        if let Some(error) = invalid_frame {
            return Err(error.into());
        }
        anyhow::bail!("没有读到可分析的音频片段");
    }
    cutoffs.sort_by(f64::total_cmp);
    let cutoff_hz =
        (!partial && is_lossless && cutoffs.len() >= 2 && cutoffs.len() as u32 == windows)
            .then(|| {
                (cutoffs[cutoffs.len() - 1] - cutoffs[0] <= 500.0)
                    .then_some(cutoffs[cutoffs.len() / 2])
            })
            .flatten();
    let relative_bands_db = if windows == 0 {
        Vec::new()
    } else {
        let peak = total.iter().copied().fold(0.0, f64::max);
        total
            .chunks(total.len().div_ceil(BANDS))
            .map(|band| {
                let max = band.iter().copied().fold(0.0, f64::max);
                (10.0 * (max / peak).log10()).max(-100.0)
            })
            .collect()
    };
    Ok(Spectrum {
        nyquist_hz: f64::from(rate) / 2.0,
        relative_bands_db,
        analyzed_seconds: analyzed_frames as f64 / f64::from(rate),
        observed_integer_bits: (is_lossless && observed_all && observed != 0)
            .then_some(32 - observed.trailing_zeros()),
        cutoff_hz,
        windows,
        partial,
    })
}
