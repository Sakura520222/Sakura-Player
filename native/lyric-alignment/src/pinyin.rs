use crate::text::{latin_only, push_unique, HAN, KANA, WORD};
use crate::types::{Part, SourceLine, TrackResult};
use pinyin::ToPinyinMulti;
use unicode_normalization::UnicodeNormalization;

/// 以词典多音字精确匹配中文音译，唯一完整路径才发布结果
/// @param line - 含已有拼音的原词及真实字词边界
pub fn align(line: &SourceLine) -> Option<TrackResult> {
    let text = line.words.join("");
    if !HAN.is_match(&text) || KANA.is_match(&text) || !latin_only(&line.romanization) {
        return None;
    }
    let mut target = String::new();
    let mut offsets = Vec::new();
    for (offset, c) in line.romanization.char_indices() {
        let value = normalize(&c.to_string());
        offsets.extend(std::iter::repeat_n(offset, value.len()));
        target.push_str(&value);
    }
    if target.is_empty() || target.len() > 1024 {
        return None;
    }
    let mut cursor = 0;
    let ranges: Vec<_> = line
        .words
        .iter()
        .enumerate()
        .map(|(index, w)| {
            let start = cursor;
            cursor += w.len();
            (start, cursor, index)
        })
        .collect();
    let mut groups: Vec<(Vec<String>, usize, usize)> = Vec::new();
    let mut leading = None;
    for (start, c) in text.char_indices() {
        let end = start + c.len_utf8();
        let covered: Vec<_> = ranges
            .iter()
            .filter(|(a, b, _)| *a < end && *b > start)
            .collect();
        if covered.is_empty() {
            continue;
        }
        let mut readings = Vec::new();
        if let Some(p) = c.to_pinyin_multi() {
            for reading in p {
                push_unique(&mut readings, normalize(reading.plain()));
            }
        } else {
            let value = normalize(&c.to_string());
            if !value.is_empty() {
                readings.push(value);
            }
        }
        if readings.is_empty() {
            if WORD.is_match(&c.to_string()) {
                return None;
            }
            if let Some(previous) = groups.last_mut() {
                previous.2 = covered.last()?.2;
            } else {
                leading = Some(covered[0].2);
            }
            continue;
        }
        groups.push((
            readings,
            leading.take().unwrap_or(covered[0].2),
            covered.last()?.2,
        ));
    }
    let width = target.len() + 1;
    let mut counts = vec![0u8; width];
    counts[0] = 1;
    let mut traces = Vec::new();
    for (readings, _, _) in &groups {
        let mut next = vec![0u8; width];
        let mut starts = vec![None; width];
        for start in 0..width {
            if counts[start] == 0 {
                continue;
            }
            for reading in readings {
                let end = start + reading.len();
                if end >= width || !target[start..].starts_with(reading) {
                    continue;
                }
                next[end] = 2.min(next[end] + counts[start]);
                starts[end] = Some(start);
            }
        }
        traces.push(starts);
        counts = next;
    }
    if counts[target.len()] != 1 {
        return None;
    }
    let mut boundaries = vec![0; groups.len()];
    cursor = target.len();
    for index in (0..groups.len()).rev() {
        cursor = traces[index][cursor]?;
        boundaries[index] = if index == 0 { 0 } else { offsets[cursor] };
    }
    let mut parts: Vec<Part> = Vec::new();
    for (index, (_, from, to)) in groups.iter().enumerate() {
        let content = &line.romanization[boundaries[index]
            ..boundaries
                .get(index + 1)
                .copied()
                .unwrap_or(line.romanization.len())];
        if parts.last().is_some_and(|p| *from <= p.to) {
            let p = parts.last_mut().unwrap();
            p.text.push_str(content);
            p.to = p.to.max(*to);
        } else {
            parts.push(Part {
                text: content.to_string(),
                from: *from,
                to: *to,
            });
        }
    }
    (!parts.is_empty()).then_some(TrackResult { parts, score: 1.0 })
}

/// 统一声调和带分音符的 ü，避免与 u 混为一个读音
/// @param text - 拼音原文或词典候选
fn normalize(text: &str) -> String {
    text.chars()
        .flat_map(|c| {
            if "üǖǘǚǜÜǕǗǙǛ".contains(c) {
                'v'.to_string()
            } else {
                c.to_string()
            }
            .nfkd()
            .collect::<Vec<_>>()
        })
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}
