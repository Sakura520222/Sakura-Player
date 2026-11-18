use std::sync::Arc;

use crate::decoder::buffer::{PopResult, Shared};

/// 平台无关的解码样本读取器。
/// DSP 已在后台线程完成；这里不获取 DSP 锁、不扩容，欠载时只补齐当前回调。
/// 所有平台的 CPAL 输出回调都从该读取器拉取样本。
pub struct DecoderSampleReader {
    shared: Arc<Shared>,
    /// DSP 后样本缓冲，直接接管 chunk 的 Vec，不复制也不扩容
    local_buffer: Vec<f32>,
    #[cfg(target_os = "windows")]
    integer_buffer: Vec<i32>,
    stem_buffer: Option<Box<[Vec<f32>; 3]>>,
    current_stems: [f32; 3],
    local_index: usize,
    local_source_samples: u64,
    reported_source_samples: u64,
    end_sample: u64,
    /// 欠载只补齐当前设备回调，下一次回调立即重新检查数据。
    underrun: bool,
    started: bool,
}

impl DecoderSampleReader {
    /// 创建同一会话的非阻塞读取器，声部与主路共用块边界
    /// @param shared - 已处理音频的有限缓冲
    /// @returns 尚未开始消费的读取器
    pub fn new(shared: Arc<Shared>) -> Self {
        Self {
            end_sample: shared.end_sample(),
            shared,
            local_buffer: Vec::new(),
            #[cfg(target_os = "windows")]
            integer_buffer: Vec::new(),
            stem_buffer: None,
            current_stems: [0.0; 3],
            local_index: 0,
            local_source_samples: 0,
            reported_source_samples: 0,
            underrun: false,
            started: false,
        }
    }

    /// 每次设备请求新缓冲时解除欠载，避免静音跨越多个回调。
    pub fn begin_callback(&mut self) {
        #[cfg(target_os = "windows")]
        if self.shared.integer_bits().is_some() {
            self.shared
                .advance_consumed(self.local_index as u64 - self.reported_source_samples);
            self.reported_source_samples = self.local_index as u64;
        } else {
            self.sync_position();
        }
        #[cfg(not(target_os = "windows"))]
        self.sync_position();
        self.end_sample = self.shared.end_sample();
        self.started = self.started || self.shared.output_ready();
        self.underrun = !self.started;
    }

    /// 取出未经处理的整数 PCM，保持与现有 CUE 终点和欠载语义一致
    #[cfg(target_os = "windows")]
    pub fn next_integer(&mut self) -> Option<i32> {
        if self.underrun {
            return None;
        }
        let pending = self.local_index as u64 - self.reported_source_samples;
        if self.end_sample != u64::MAX
            && self
                .local_index
                .is_multiple_of(usize::from(self.shared.channels()))
            && self.shared.samples_consumed_count() + pending >= self.end_sample
        {
            self.shared.advance_consumed(pending);
            self.reported_source_samples = self.local_index as u64;
            self.shared.mark_all_consumed();
            return None;
        }
        if self.local_index == self.integer_buffer.len() {
            self.shared.advance_consumed(pending);
            self.reported_source_samples = 0;
            self.local_index = 0;
            self.shared
                .recycle_integer_buffer(std::mem::take(&mut self.integer_buffer));
            match self.shared.try_pop() {
                PopResult::Integer(samples) => self.integer_buffer = samples,
                PopResult::Pending => {
                    self.underrun = true;
                    self.shared.record_underrun();
                    return None;
                }
                PopResult::Finished => {
                    self.shared.mark_all_consumed();
                    return None;
                }
                PopResult::Chunk(_) => unreachable!("直通队列只能包含整数样本"),
            }
        }
        let sample = self.integer_buffer[self.local_index];
        self.local_index += 1;
        Some(sample)
    }

    /// 返回直通有效位深供设备写入时核对
    #[cfg(target_os = "windows")]
    pub fn integer_bits(&self) -> Option<u32> {
        self.shared.integer_bits()
    }

    /// 发布已提交给设备的实际 PCM 样本数
    /// @param samples - 通过比较的样本数
    #[cfg(target_os = "windows")]
    pub fn report_verified_samples(&self, samples: u64) {
        self.shared.report_verified_samples(samples);
    }

    /// 记录设备缓冲与解码样本不一致
    #[cfg(target_os = "windows")]
    pub fn mark_pcm_invalid(&self) {
        self.shared.mark_pcm_invalid();
    }

    pub fn is_underrun(&self) -> bool {
        self.underrun
    }

    /// 获取最近一条主路采样对应的三路声部，回调中只读取固定数组
    /// @returns 鼓、贝斯和人声采样
    pub fn current_stems(&self) -> [f32; 3] {
        self.current_stems
    }

    /// 获取包含当前回调尚未发布部分的源采样位置
    /// @returns 从本次解码起点累计的交错源采样数
    pub fn source_sample_position(&self) -> u64 {
        let pending = if self.local_buffer.is_empty() {
            0
        } else {
            self.local_source_samples * self.local_index as u64 / self.local_buffer.len() as u64
                - self.reported_source_samples
        };
        self.shared.samples_consumed_count() + pending
    }

    /// 按实际取出的输出样本映射源位置，每个回调批量发布，避免逐样本原子写入
    pub fn sync_position(&mut self) {
        if self.local_buffer.is_empty() {
            return;
        }
        let consumed =
            self.local_source_samples * self.local_index as u64 / self.local_buffer.len() as u64;
        self.shared
            .advance_consumed(consumed - self.reported_source_samples);
        self.reported_source_samples = consumed;
    }
}

impl Iterator for DecoderSampleReader {
    type Item = f32;

    /// 非阻塞读取一条采样，CUE 终点只在完整声道帧上截断
    /// @returns 输出采样或流结束标记
    fn next(&mut self) -> Option<f32> {
        if self.stem_buffer.is_some() {
            self.current_stems = [0.0; 3];
        }
        if self.end_sample != u64::MAX
            && self
                .local_index
                .is_multiple_of(usize::from(self.shared.channels()))
            && self.source_sample_position() >= self.end_sample
        {
            self.sync_position();
            self.shared.mark_all_consumed();
            return None;
        }
        if let Some(sample) = self.local_buffer.get(self.local_index).copied() {
            if let Some(stems) = &self.stem_buffer {
                self.current_stems = std::array::from_fn(|index| stems[index][self.local_index]);
            }
            self.local_index += 1;
            return Some(sample);
        }
        if !self.local_buffer.is_empty() {
            self.sync_position();
            self.shared
                .recycle_player_buffer(std::mem::take(&mut self.local_buffer));
            self.local_index = 0;
            if let Some(stems) = self.stem_buffer.take() {
                for samples in *stems {
                    self.shared.recycle_player_buffer(samples);
                }
            }
        }
        if self.underrun {
            return Some(0.0);
        }

        // 慢速路径：从共享缓冲区非阻塞获取，跳过空数据块
        loop {
            match self.shared.try_pop() {
                PopResult::Chunk(chunk) => {
                    if !chunk.player_samples.is_empty() {
                        self.local_source_samples = chunk.source_sample_count;
                        self.reported_source_samples = 0;
                        self.local_buffer = chunk.player_samples;
                        self.stem_buffer = chunk.stem_samples;
                        if let Some(stems) = &self.stem_buffer {
                            self.current_stems = std::array::from_fn(|index| stems[index][0]);
                        }
                        self.local_index = 1;
                        return self.local_buffer.first().copied();
                    }
                    self.shared.advance_consumed(chunk.source_sample_count);
                    self.shared.recycle_player_buffer(chunk.player_samples);
                }
                PopResult::Integer(_) => unreachable!("处理队列只能包含浮点样本"),
                PopResult::Pending => {
                    self.underrun = true;
                    self.shared.record_underrun();
                    return Some(0.0);
                }
                PopResult::Finished => {
                    // 数据源耗尽，标记消费完毕
                    self.shared.mark_all_consumed();
                    return None;
                }
            }
        }
    }
}

impl Drop for DecoderSampleReader {
    /// 归还仍持有的主路与声部缓冲
    fn drop(&mut self) {
        if let Some(stems) = self.stem_buffer.take() {
            for samples in *stems {
                self.shared.recycle_player_buffer(samples);
            }
        }
        self.shared
            .recycle_player_buffer(std::mem::take(&mut self.local_buffer));
    }
}

/// 解码样本读取器别名，作为播放输出链路的输入类型
#[cfg(test)]
pub type DecoderSource = DecoderSampleReader;

#[cfg(test)]
#[path = "tests/source.rs"]
mod tests;
