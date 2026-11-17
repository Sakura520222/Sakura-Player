mod audio;
pub mod ctc;
pub mod text;

use crate::readings::Linguistics;
use anyhow::{ensure, Context, Result};
use ort::{ep, session::Session, value::Tensor};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub source: PathBuf,
    pub offset_ms: f64,
    pub language: String,
    pub lines: Vec<Line>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub id: u64,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub word: String,
    pub start_time: f64,
    pub end_time: f64,
}

#[derive(Serialize)]
pub struct Timing {
    pub words: Vec<Word>,
    pub score: f64,
    pub warnings: Vec<String>,
}

#[derive(Serialize)]
pub struct LineResult {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary: Option<Timing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

pub struct AcousticModel {
    session: Session,
}

impl AcousticModel {
    /// 复用 AutoMix 的动态 ONNX Runtime，只在当前工作进程载入声学模型
    /// @param directory - 已校验的声学模型目录
    /// @param runtime - 主进程提供的共用运行库绝对路径
    pub fn load(directory: &Path, runtime: &Path) -> Result<Self> {
        ensure!(
            runtime.is_absolute() && runtime.is_file(),
            "声学运行库未就绪"
        );
        ort::init_from(runtime)?
            .with_name("LyricAlignment")
            .with_telemetry(false)
            .commit();
        let session = Session::builder()?
            .with_intra_threads(2)?
            .with_inter_threads(1)?
            .with_memory_pattern(false)?
            .with_config_entry("session.intra_op.allow_spinning", "0")?
            .with_execution_providers([ep::CPU::default().with_arena_allocator(false).build()])?
            .commit_from_file(directory.join("mms_fa_uint8.onnx"))?;
        Ok(Self { session })
    }

    /// 推理单行 PCM，读取固定模型导出的 CTC 对数概率
    /// @param samples - 16 kHz 单声道窗口
    /// @returns 连续帧的 29 类预测
    fn emissions(&mut self, samples: Vec<f32>) -> Result<Vec<f32>> {
        let outputs = self.session.run(ort::inputs![Tensor::from_array((
            [1, samples.len()],
            samples
        ))?])?;
        let (shape, values) = outputs[0].try_extract_tensor::<f32>()?;
        ensure!(
            shape.len() == 3 && shape[0] == 1 && shape[2] == 29 && shape[1] > 0 && shape[1] <= 1500,
            "声学模型输出形状不符"
        );
        // 第 29 类为固定零值的缺词通配符，不参与匹配，也不能再次 softmax 稀释真实字音概率
        ensure!(
            values.iter().all(|v| v.is_finite() && *v <= 0.001),
            "声学预测无效"
        );
        Ok(values.to_vec())
    }

    /// 执行一次有限推理验证，检查安装后的模型与运行库是否兼容
    pub fn verify(&mut self) -> Result<()> {
        self.emissions(vec![0.0; 16000])?;
        Ok(())
    }

    /// 按行执行声学匹配，单行读音不明或置信度不足时保留未匹配状态
    /// @param request - 带主进程音源身份与行级时间的有界请求
    /// @returns 每行候选或未匹配原因
    pub fn align(&mut self, request: Request) -> Result<Vec<LineResult>> {
        ensure!(
            matches!(request.language.as_str(), "zh" | "ja" | "en"),
            "不支持的声学语言"
        );
        ensure!(
            request.source.is_absolute()
                && request.source.is_file()
                && request.offset_ms.is_finite()
                && request.offset_ms >= 0.0,
            "声学音源无效"
        );
        ensure!(
            !request.lines.is_empty() && request.lines.len() <= 1000,
            "声学歌词行数无效"
        );
        let mut ids = HashSet::new();
        let mut size = 0;
        for line in &request.lines {
            size += line.text.encode_utf16().count();
            ensure!(
                ids.insert(line.id) && line.text.encode_utf16().count() <= 2048 && size <= 64000,
                "声学歌词超过限制"
            );
            ensure!(
                line.start_time.is_finite()
                    && line.end_time.is_finite()
                    && line.start_time >= 0.0
                    && line.end_time > line.start_time
                    && line.end_time <= 86_400_000.0,
                "歌词时间无效"
            );
        }
        let linguistics = Linguistics::new(request.language == "ja")?;
        let mut results = Vec::with_capacity(request.lines.len());
        for line in request.lines {
            let result = (|| -> Result<Timing> {
                let units = text::prepare(&line.text, &request.language, &linguistics)?;
                let duration = line.end_time - line.start_time;
                let mut emissions = Vec::new();
                let mut chunk_start = line.start_time;
                let mut audible = false;
                while chunk_start < line.end_time {
                    let chunk_end = (chunk_start + 20_000.0).min(line.end_time);
                    let window_start = (chunk_start - 500.0).max(line.start_time);
                    let window_end = (chunk_end + 500.0).min(line.end_time);
                    let samples = audio::decode(
                        &request.source,
                        window_start + request.offset_ms,
                        window_end + request.offset_ms,
                    )?;
                    audible |= samples.iter().any(|sample| sample.abs() > 0.001);
                    let prediction = self.emissions(samples)?;
                    let frame_ms = (window_end - window_start) / (prediction.len() / 29) as f64;
                    for (frame, values) in prediction.as_chunks::<29>().0.iter().enumerate() {
                        let center = window_start + (frame as f64 + 0.5) * frame_ms;
                        if center >= chunk_start && center < chunk_end {
                            emissions.extend_from_slice(values);
                        }
                    }
                    chunk_start = chunk_end;
                }
                let tokens: Vec<_> = units
                    .iter()
                    .flat_map(|u| u.tokens.iter().copied())
                    .collect();
                let spans = ctc::align(&emissions, 29, &tokens)?;
                let frame_ms = duration / (emissions.len() / 29) as f64;
                let mut cursor = 0;
                let mut words = Vec::new();
                let score = spans.iter().map(|s| s.score).sum::<f64>() / spans.len() as f64;
                let mut warnings = Vec::new();
                if duration > 30_000.0 {
                    warnings.push("本行较长，已分段处理，请检查字词位置".into());
                }
                if score < 0.35 {
                    warnings.push("整体声学匹配较弱，时间可能不准确".into());
                }
                if !audible {
                    warnings.push("该行未检测到明显声音，时间仅为低可信候选".into());
                }
                if units.iter().any(|unit| unit.uncertain) {
                    warnings.push("部分文字或数字读音未知，已用声学通配符估算".into());
                }
                let mut weak_words = false;
                for unit in units {
                    let group = &spans[cursor..cursor + unit.tokens.len()];
                    cursor += unit.tokens.len();
                    weak_words |=
                        group.iter().map(|s| s.score).sum::<f64>() / (group.len() as f64) < 0.02;
                    let first = group.first().context("字音为空")?;
                    let last = group.last().context("字音为空")?;
                    words.push(Word {
                        word: unit.text,
                        start_time: (line.start_time + first.start as f64 * frame_ms).round(),
                        end_time: (line.start_time + last.end as f64 * frame_ms)
                            .round()
                            .min(line.end_time),
                    });
                }
                if weak_words {
                    warnings.push("部分字词声学证据较弱，请试听检查".into());
                }
                Ok(Timing {
                    words,
                    score,
                    warnings,
                })
            })();
            results.push(match result {
                Ok(timing) => LineResult {
                    id: line.id,
                    primary: Some(timing),
                    reason: None,
                },
                Err(error) => LineResult {
                    id: line.id,
                    primary: None,
                    reason: Some(error.to_string()),
                },
            });
        }
        Ok(results)
    }
}
