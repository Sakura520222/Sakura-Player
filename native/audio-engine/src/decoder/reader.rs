use super::input::AudioInput;
use super::*;

impl DecoderData {
    /// 在已有 reader 上 seek，失败时调用方应回退到完整 load
    ///
    /// seek 后清理播放重采样器中的残留样本
    pub fn seek(&mut self, position_secs: f64) -> bool {
        if let Some(handle) = &self.cancel_handle {
            handle.reset();
        }
        let target = Duration::from_secs_f64(position_secs);
        if self.reader.seek(target, SeekMode::Accurate).is_err()
            && self.reader.seek(target, SeekMode::Coarse).is_err()
        {
            return false;
        }
        if let Some(player) = &mut self.player_resampler {
            let _ = player.flush();
        }
        true
    }

    /// 获取网络中断句柄，恢复解码时绑定到新的共享状态
    pub fn cancel_handle(&self) -> Option<HttpCancelHandle> {
        self.cancel_handle.clone()
    }

    /// 根据最终的开流结果重建输出格式，直通时释放重采样器
    /// @param shared - 已按实际输出格式建立的共享缓冲
    pub fn reconfigure_player_output(&mut self, shared: &Shared) -> Result<()> {
        self.player_resampler = if shared.integer_bits().is_some() {
            None
        } else {
            Some(build_player_resampler(
                &self.reader,
                shared.sample_rate(),
                shared.channels(),
            )?)
        };
        Ok(())
    }

    /// 查询设备重建时应保留的音源整数规格
    pub fn integer_spec(&self) -> Option<super::direct::IntegerPcmSpec> {
        super::direct::IntegerPcmSpec::from_source(
            self.reader.source_info(),
            self.cancel_handle.is_none(),
        )
    }
}

/// 网络音频代理策略，由主进程按应用代理设置同步，不读取系统代理
pub(crate) static HTTP_PROXY: RwLock<HttpProxy> = RwLock::new(HttpProxy::Direct);

/// 根据协议打开网络或本地音频
/// @param source - 音频地址或文件路径
/// @param cancel_handle - 网络读取取消句柄
/// @returns 解码器及网络音频的取消句柄
pub(super) fn open_source(
    source: &str,
    cancel_handle: HttpCancelHandle,
) -> Result<(AudioReader, Option<HttpCancelHandle>)> {
    let (reader, cancel) = if source.starts_with("http://") || source.starts_with("https://") {
        let proxy = HTTP_PROXY.read().clone();
        let http = HttpAudioSource::new_with_proxy(source, &cancel_handle, &proxy)?;
        let reader = AudioReader::new(AudioInput::new(http)?).context("打开网络音频失败")?;
        (reader, Some(cancel_handle))
    } else {
        let file = File::open(source).with_context(|| format!("打开本地文件失败: {source}"))?;
        let reader = AudioReader::new(AudioInput::new(file)?)
            .with_context(|| format!("打开本地音频失败: {source}"))?;
        (reader, None)
    };

    Ok((reader, cancel))
}

/// 创建普通播放的交错 PCM 转换器
/// @param reader - 已打开的音频流
/// @param target_rate - 输出流采样率
/// @param target_channels - 输出流声道数
pub(super) fn build_player_resampler(
    reader: &AudioReader,
    target_rate: u32,
    target_channels: u16,
) -> Result<Resampler> {
    let player_opts = ResampleOptions::new()
        .sample_rate(target_rate as i32)
        .channels(i32::from(target_channels))
        .format::<f32>();
    reader
        .build_resampler(player_opts)
        .with_context(|| "构建播放重采样器失败")
}

/// 解码并将交错播放样本交给现有 DSP 队列
/// @param data - 当前解码器和重采样器
/// @param shared - 音频缓冲与响度参数
pub(super) fn run_decoding_loop(data: &mut DecoderData, shared: &Shared) {
    let player_resampler = data
        .player_resampler
        .as_mut()
        .expect("处理模式必须配置重采样器");
    // 响度归一化：有 ReplayGain 标签时用固定增益，否则用实时分析
    let tagged_gain = shared.normalization_gain();
    let mut loudness = LoudnessAnalyzer::new(shared.sample_rate(), shared.channels());
    loudness.set_has_replay_gain(tagged_gain.is_some());

    // 用于日志诊断：记录是否曾成功解码过帧
    let mut had_success = false;

    loop {
        // 背压：缓冲区满时阻塞等待消费
        if !shared.wait_for_space() {
            return;
        }

        match data.reader.receive_frame() {
            Ok(Some(frame)) => {
                if player_resampler.process::<f32>(Some(&frame)).is_err() {
                    debug!("player resampler 处理失败，结束解码");
                    shared.mark_decode_failed();
                    return;
                }
                let mut player_samples = shared.take_player_buffer();
                player_samples.extend_from_slice(player_resampler.output_as::<f32>());

                // 重采样可能还在攒样本，本轮没出数据就跳过
                if player_samples.is_empty() {
                    shared.recycle_player_buffer(player_samples);
                    continue;
                }
                had_success = true;

                let mut normalization_gain = 1.0;

                if shared.is_normalization_enabled() && !player_samples.is_empty() {
                    let gain = tagged_gain.unwrap_or_else(|| loudness.process(&player_samples));
                    normalization_gain = gain;
                    if (gain - 1.0).abs() > f32::EPSILON {
                        for s in &mut player_samples {
                            *s *= gain;
                        }
                    }
                }

                shared.push(AudioChunk {
                    normalization_gain,
                    stem_samples: None,
                    source_sample_count: player_samples.len() as u64,
                    player_samples,
                });
            }
            Ok(None) | Err(AudioError::Eof) => {
                // EOF flush：把重采样器内部残留挤出来，否则最后几十毫秒丢
                let _ = player_resampler.process::<f32>(None);
                let mut player_samples = shared.take_player_buffer();
                player_samples.extend_from_slice(player_resampler.output_as::<f32>());
                if !player_samples.is_empty() {
                    shared.push(AudioChunk {
                        normalization_gain: 1.0,
                        stem_samples: None,
                        source_sample_count: player_samples.len() as u64,
                        player_samples,
                    });
                } else {
                    shared.recycle_player_buffer(player_samples);
                }
                return;
            }
            Err(e) => {
                // stop/切歌触发的 HTTP 取消不是源故障
                if shared.is_stopping() {
                    debug!("解码线程因停止信号退出");
                    return;
                }
                // 本地 File 的 io::Error 可能经 ffmpeg_audio read 回调映射为 AVERROR(EIO)
                let io_failure = match &e {
                    AudioError::Io(_) => true,
                    AudioError::FFmpeg(code, _) => *code == AVERROR_EIO,
                    _ => false,
                };
                // 统一标记 decode_failed：包括 IO 错误和 FFmpeg 数据错误
                // 长时间暂停后 HTTP 流断开重连、URL 过期等场景下 FFmpeg 会报
                // INVALIDDATA（非 EIO），但本质仍是数据源故障，需要标记以触发
                // SourceError 让 JS 重新解析播放地址
                // 尾部坏帧（FLAC ID3v1 / VBR 末帧）容忍由 position timer 的 3s
                // 阈值保障：mark_decode_failed 后若 position 接近末尾仍发 Ended
                shared.mark_decode_failed();
                if data.cancel_handle.is_some() {
                    debug!(had_success, io_failure, "网络音频解码异常结束");
                } else {
                    debug!(error = %e, had_success, io_failure, "解码线程异常结束");
                }
                return;
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/reader.rs"]
mod tests;
