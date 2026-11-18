use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use napi::bindgen_prelude::*;
use napi_derive::napi;
use parking_lot::Mutex;

use super::IntoNapiResult;
use crate::quality;

/// 容器中可跳转的章节，时间以毫秒为单位
#[napi(object)]
pub struct JsAudioChapter {
    pub start_ms: f64,
    pub end_ms: Option<f64>,
    pub title: Option<String>,
}

/// 本地文件检查结果，解码样本表示和源有效位深独立
#[napi(object)]
pub struct JsLocalAudioInfo {
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub valid_bits: u32,
    pub decoded_format: Option<String>,
    pub is_lossless: bool,
    pub container_format: Option<String>,
    pub audio_bit_rate: Option<f64>,
    pub container_bit_rate: Option<f64>,
    pub channel_layout: Option<String>,
    pub chapters: Vec<JsAudioChapter>,
    pub replay_gain_track_db: Option<f64>,
    pub replay_gain_album_db: Option<f64>,
    pub replay_gain_track_peak: Option<f64>,
    pub replay_gain_album_peak: Option<f64>,
    pub r128_track_gain_db: Option<f64>,
    pub r128_album_gain_db: Option<f64>,
}

/// 读取本地文件的音质与章节，不改变播放器状态
/// @param path - 实体音频文件路径
#[napi]
pub async fn inspect_audio_file(path: String) -> Result<JsLocalAudioInfo> {
    let info = tokio::task::spawn_blocking(move || quality::inspect(Path::new(&path)))
        .await
        .map_err(|error| Error::from_reason(format!("音频探测任务失败: {error}")))?
        .into_napi()?;
    let (container_format, audio_bit_rate, container_bit_rate, channel_layout, chapters) = info
        .container
        .map(|container| {
            (
                Some(container.format),
                (container.audio_bit_rate > 0).then_some(container.audio_bit_rate as f64),
                (container.container_bit_rate > 0).then_some(container.container_bit_rate as f64),
                container.channel_layout,
                container
                    .chapters
                    .into_iter()
                    .map(|chapter| JsAudioChapter {
                        start_ms: chapter.start_ms,
                        end_ms: chapter.end_ms,
                        title: chapter.title,
                    })
                    .collect(),
            )
        })
        .unwrap_or_default();
    Ok(JsLocalAudioInfo {
        codec: info.codec,
        sample_rate: info.sample_rate,
        channels: info.channels,
        valid_bits: info.valid_bits,
        decoded_format: info.decoded_format,
        is_lossless: info.is_lossless,
        container_format,
        audio_bit_rate,
        container_bit_rate,
        channel_layout,
        chapters,
        replay_gain_track_db: info.replay_gain_track_db.map(f64::from),
        replay_gain_album_db: info.replay_gain_album_db.map(f64::from),
        replay_gain_track_peak: info.replay_gain_track_peak.map(f64::from),
        replay_gain_album_peak: info.replay_gain_album_peak.map(f64::from),
        r128_track_gain_db: info.r128_track_gain_db.map(f64::from),
        r128_album_gain_db: info.r128_album_gain_db.map(f64::from),
    })
}

/// 旁路分析使用独立解码器，仅回传小型频带汇总
#[napi(object)]
pub struct JsAudioSpectrum {
    pub nyquist_hz: f64,
    pub relative_bands_db: Vec<f64>,
    pub analyzed_seconds: f64,
    pub observed_integer_bits: Option<u32>,
    pub cutoff_hz: Option<f64>,
    pub windows: u32,
    pub partial: bool,
}

/// 活跃频谱任务只保留当前请求，替换或关闭时发送取消信号
struct SpectrumJob {
    id: Option<String>,
    canceled: Arc<AtomicBool>,
}

static SPECTRUM_JOB: Mutex<Option<SpectrumJob>> = Mutex::new(None);

/// 持有任务登记时创建的取消标志，交由原生线程池执行解码
pub struct SpectrumTask {
    path: String,
    start_ms: f64,
    end_ms: Option<f64>,
    canceled: Arc<AtomicBool>,
}

impl Task for SpectrumTask {
    type Output = JsAudioSpectrum;
    type JsValue = JsAudioSpectrum;

    /// 分析音频并释放仍属于本次请求的任务登记
    fn compute(&mut self) -> Result<Self::Output> {
        let result = quality::analyze(
            Path::new(&self.path),
            self.start_ms / 1000.0,
            self.end_ms.map(|end| end / 1000.0),
            &self.canceled,
        );
        let mut current = SPECTRUM_JOB.lock();
        if current
            .as_ref()
            .is_some_and(|job| Arc::ptr_eq(&job.canceled, &self.canceled))
        {
            current.take();
        }
        drop(current);
        let spectrum = result.into_napi()?;
        Ok(JsAudioSpectrum {
            nyquist_hz: spectrum.nyquist_hz,
            relative_bands_db: spectrum.relative_bands_db,
            analyzed_seconds: spectrum.analyzed_seconds,
            observed_integer_bits: spectrum.observed_integer_bits,
            cutoff_hz: spectrum.cutoff_hz,
            windows: spectrum.windows,
            partial: spectrum.partial,
        })
    }

    /// 将小型频带汇总交还给调用方
    /// @param _env - 回调所在的 N-API 环境
    /// @param output - 解码线程生成的频谱
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// 停止当前弹窗提交的频谱任务
/// @param id - 调用方生成的任务标识
#[napi]
pub fn cancel_audio_spectrum(id: String) {
    if let Some(job) = SPECTRUM_JOB.lock().as_ref() {
        if job.id.as_ref() == Some(&id) {
            job.canceled.store(true, Ordering::Relaxed);
        }
    }
}

/// 同步登记取消标志并在后台分析本地曲目，再次分析会取消过期任务
/// @param path - 实体文件路径
/// @param start_ms - 分轨起点，毫秒
/// @param end_ms - 分轨终点，毫秒
/// @param id - 用于取消的调用方任务标识
#[napi]
pub fn analyze_audio_spectrum(
    path: String,
    start_ms: f64,
    end_ms: Option<f64>,
    id: Option<String>,
) -> AsyncTask<SpectrumTask> {
    let canceled = Arc::new(AtomicBool::new(false));
    let previous = SPECTRUM_JOB.lock().replace(SpectrumJob {
        id,
        canceled: Arc::clone(&canceled),
    });
    if let Some(previous) = previous {
        previous.canceled.store(true, Ordering::Relaxed);
    }
    AsyncTask::new(SpectrumTask {
        path,
        start_ms,
        end_ms,
        canceled,
    })
}
