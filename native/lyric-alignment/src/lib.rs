mod model_file;
pub mod pinyin;
pub mod readings;
pub mod romanization;
pub mod segmentation;
pub mod semantic;
pub mod text;
pub mod translation;
pub mod types;

use anyhow::Result;
use readings::{target_words, Linguistics};
use semantic::SemanticModel;
use std::path::Path;
use types::{LineResult, Phrase, ReadingToken, Request, Response, TrackResult};

pub struct PreparedLine {
    pub id: u64,
    pub source: Vec<ReadingToken>,
    pub phrases: Vec<Phrase>,
    pub target: Vec<String>,
    pub romanization: Option<TrackResult>,
}

/// 对整次请求执行有界的分词和音译，词典只在本次调用中存活
/// @param request - 已有歌词快照及选项
pub fn prepare(request: &Request) -> Result<Vec<PreparedLine>> {
    request.validate()?;
    let linguistics = Linguistics::new(
        request
            .lines
            .iter()
            .any(|l| text::CJK.is_match(&l.words.join(""))),
    )?;
    request
        .lines
        .iter()
        .map(|line| {
            let (source, phonetic, phrases) = linguistics.tokenize(
                line,
                request.translation && !line.translation.trim().is_empty(),
            )?;
            let romanization = if request.romanization && !line.romanization.is_empty() {
                pinyin::align(line)
                    .or_else(|| romanization::align(&phonetic, &line.romanization))
                    .filter(|r| r.parts.len() > 1)
            } else {
                None
            };
            Ok(PreparedLine {
                id: line.id,
                source,
                phrases,
                target: target_words(&line.translation),
                romanization,
            })
        })
        .collect()
}

/// 原生执行已有辅助歌词对齐，翻译失败时仍返回已完成的音译
/// @param request - 有界歌词请求
/// @param model_directory - 主进程持有使用权的本地模型目录
pub fn align(request: &Request, model_directory: Option<&Path>) -> Result<Response> {
    let prepared = prepare(request)?;
    let translation = request.translation
        && request
            .lines
            .iter()
            .any(|l| !l.translation.trim().is_empty());
    let mut translation_error = None;
    let model = if translation {
        match model_directory.map_or_else(
            || Err(anyhow::anyhow!("请先下载对齐模型")),
            SemanticModel::load,
        ) {
            Ok(model) => Some(model),
            Err(error) => {
                translation_error = Some(error.to_string());
                None
            }
        }
    } else {
        None
    };
    let mut lines = Vec::new();
    for line in prepared {
        let mut result = LineResult {
            id: line.id,
            translation: None,
            romanization: line.romanization,
        };
        if let Some(model) = &model {
            if !line.source.is_empty() && line.target.iter().any(|s| !s.trim().is_empty()) {
                match model.align(
                    &line
                        .source
                        .iter()
                        .map(|t| t.text.clone())
                        .collect::<Vec<_>>(),
                    &line.target,
                    &line.phrases,
                ) {
                    Ok(candidates) => {
                        for pairs in candidates {
                            if let Some(translation) =
                                translation::align(&line.source, &line.target, &pairs)
                            {
                                result.translation = Some(translation);
                                break;
                            }
                        }
                    }
                    Err(error) => {
                        translation_error = Some(error.to_string());
                    }
                }
            }
        }
        lines.push(result);
    }
    if translation_error.is_some() {
        for line in &mut lines {
            line.translation = None;
        }
    }
    Ok(Response {
        lines,
        translation_error,
    })
}
