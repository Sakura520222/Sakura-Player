use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub request_id: String,
    pub lines: Vec<SourceLine>,
    pub translation: bool,
    pub romanization: bool,
}

impl Request {
    /// 校验与 IPC 相同的歌词边界，直接启动工作进程也不能绕过资源限制
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.request_id.is_empty()
                && self.request_id.len() <= 100
                && self
                    .request_id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-'),
            "对齐请求编号无效"
        );
        ensure!(self.translation || self.romanization, "未选择对齐轨道");
        ensure!(
            !self.lines.is_empty() && self.lines.len() <= 1000,
            "歌词行数无效"
        );
        let mut ids = HashSet::new();
        let mut size = 0;
        for line in &self.lines {
            ensure!(ids.insert(line.id), "歌词行号重复");
            ensure!(
                !line.words.is_empty() && line.words.len() <= 256,
                "原文字词数量无效"
            );
            ensure!(
                line.readings
                    .as_ref()
                    .is_none_or(|v| v.len() == line.words.len()),
                "注音数量无效"
            );
            for text in line.words.iter().chain(line.readings.iter().flatten()) {
                let length = text.encode_utf16().count();
                ensure!(length <= 1024, "歌词字词过长");
                size += length;
            }
            for text in [&line.translation, &line.romanization] {
                let length = text.encode_utf16().count();
                ensure!(length <= 2048, "辅助歌词过长");
                size += length;
            }
            ensure!(size <= 64_000, "歌词过长，无法进行本地对齐");
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SourceLine {
    pub id: u64,
    pub words: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readings: Option<Vec<String>>,
    pub translation: String,
    pub romanization: String,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Part {
    pub text: String,
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct TrackResult {
    pub parts: Vec<Part>,
    pub score: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ReadingToken {
    pub text: String,
    #[serde(default)]
    pub reading: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readings: Option<Vec<String>>,
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Phrase {
    pub text: String,
    pub indices: Vec<usize>,
    #[serde(default)]
    pub heads: Vec<usize>,
    #[serde(default)]
    pub lemmas: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct LineResult {
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation: Option<TrackResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub romanization: Option<TrackResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub lines: Vec<LineResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation_error: Option<String>,
}
