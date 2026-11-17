use crate::audio_input::AudioInput;
use anyhow::{ensure, Result};
use ffmpeg_audio::{AudioReader, ResampleOptions, SeekMode};
use std::{fs::File, path::Path, time::Duration};

/// 使用播放器相同的静态 FFmpeg 与容器读取视图解码单行窗口
/// @param source - 本地或完整缓存音源
/// @param start_ms - 包含 CUE 起点的源时间
/// @param end_ms - 源时间终点
/// @returns 固定 16 kHz 单声道采样，不保留整首音频
pub fn decode(source: &Path, start_ms: f64, end_ms: f64) -> Result<Vec<f32>> {
    ensure!(
        start_ms.is_finite()
            && end_ms.is_finite()
            && start_ms >= 0.0
            && end_ms > start_ms
            && end_ms - start_ms <= 30_000.0,
        "音频窗口无效"
    );
    let start = start_ms / 1000.0;
    let end = end_ms / 1000.0;
    let mut reader = AudioReader::new(AudioInput::new(File::open(source)?)?)?;
    if start > 0.0
        && reader
            .seek(Duration::from_secs_f64(start), SeekMode::Accurate)
            .is_err()
    {
        reader = AudioReader::new(AudioInput::new(File::open(source)?)?)?;
    }
    let mut converter = reader.build_resampler(
        ResampleOptions::new()
            .sample_rate(16000)
            .channels(1)
            .format::<f32>(),
    )?;
    let mut samples = vec![0.0; ((end - start) * 16000.0).round() as usize];
    let mut decoded_until = 0.0;
    let mut received = 0;
    while let Some(frame) = reader.receive_frame()? {
        let position = frame
            .pts()
            .map(|v| v.as_secs_f64())
            .unwrap_or(decoded_until);
        decoded_until = position + frame.duration().as_secs_f64();
        converter.process::<f32>(Some(&frame))?;
        for (index, sample) in converter.output_as::<f32>().iter().enumerate() {
            let at = ((position - start) * 16000.0).round() as i64 + index as i64;
            if at >= 0 && (at as usize) < samples.len() {
                ensure!(sample.is_finite(), "音源含无效采样");
                samples[at as usize] = *sample;
                received += 1;
            }
        }
        if decoded_until >= end {
            break;
        }
    }
    ensure!(received > 0, "该范围没有可解码音频");
    samples.resize(samples.len().max(400), 0.0);
    Ok(samples)
}
