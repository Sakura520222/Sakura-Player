use crate::text::WORD;
use crate::types::{Part, ReadingToken, TrackResult};
use std::collections::BTreeSet;

/// 将语义词对映射回原词范围，保留译文语序并拒绝覆盖不足的结果
/// @param source - 带主歌词范围的语义词元
/// @param target - 保留空白和标点的译文分词
/// @param pairs - 原文与译文词下标配对
pub fn align(
    source: &[ReadingToken],
    target: &[String],
    pairs: &[[usize; 2]],
) -> Option<TrackResult> {
    if source.is_empty() || target.is_empty() {
        return None;
    }
    let mut anchors = vec![BTreeSet::new(); target.len()];
    let mut covered = BTreeSet::new();
    let source_words: Vec<_> = source.iter().map(|t| WORD.is_match(&t.text)).collect();
    let target_lengths: Vec<_> = target.iter().map(|s| WORD.find_iter(s).count()).collect();
    for &[from, to] in pairs {
        if from >= source.len() || to >= anchors.len() {
            return None;
        }
        if !source_words[from] || target_lengths[to] == 0 {
            continue;
        }
        anchors[to].insert(from);
        covered.insert(from);
    }
    let source_count = source_words.iter().filter(|v| **v).count();
    let target_length: usize = target_lengths.iter().sum();
    if source_count == 0 || target_length == 0 {
        return None;
    }
    let sc = covered.len() as f64 / source_count as f64;
    let tc = target_lengths
        .iter()
        .enumerate()
        .map(|(i, n)| if anchors[i].is_empty() { 0 } else { *n })
        .sum::<usize>() as f64
        / target_length as f64;
    if tc < 0.5 {
        return None;
    }
    let score = 2.0 * sc * tc / (sc + tc);
    if score < 0.65 {
        return None;
    }
    let mut aligned: Vec<Part> = Vec::new();
    let mut pending = String::new();
    for (index, text) in target.iter().enumerate() {
        let indices = &anchors[index];
        if indices.is_empty() {
            if target_lengths[index] == 0 && pending.is_empty() && !aligned.is_empty() {
                aligned.last_mut()?.text.push_str(text);
            } else {
                pending.push_str(text);
            }
            continue;
        }
        let part = Part {
            text: std::mem::take(&mut pending) + text,
            from: indices.iter().map(|i| source[*i].from).min()?,
            to: indices.iter().map(|i| source[*i].to).max()?,
        };
        if aligned
            .last()
            .is_some_and(|p| p.from == part.from && p.to == part.to)
        {
            aligned.last_mut()?.text.push_str(&part.text);
        } else {
            aligned.push(part);
        }
    }
    if !pending.is_empty() {
        if let Some(p) = aligned.last_mut() {
            p.text.push_str(&pending);
        }
    }
    let mut parts: Vec<Part> = Vec::new();
    for original in &aligned {
        let mut part = original.clone();
        while parts.last().is_some_and(|p| p.to >= part.from) {
            let previous = parts.pop()?;
            part.text = previous.text + &part.text;
            part.from = previous.from.min(part.from);
            part.to = previous.to.max(part.to);
        }
        parts.push(part);
    }
    if parts.len() > 1 {
        return Some(TrackResult { parts, score });
    }
    (aligned.len() > 1
        && aligned.iter().map(|p| p.to).min()? < aligned.iter().map(|p| p.from).max()?)
    .then_some(TrackResult {
        parts: aligned,
        score,
    })
}
