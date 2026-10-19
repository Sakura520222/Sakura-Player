use crate::text::{
    boundary, latin_only, normalize, push_unique, Normalized, CJK, HAN, HAN_ONLY, UNRESOLVED, WORD,
};
use crate::types::{Part, ReadingToken, TrackResult};
use regex::Regex;
use std::sync::LazyLock;

struct Group {
    text: String,
    readings: Vec<String>,
    from: usize,
    to: usize,
    anchor_from: usize,
    anchor_to: usize,
}

/// 匹配转写差异和省略促音，完整保留现有音译文本及原词范围
/// @param tokens - 有候选读音的原词
/// @param existing - 已有音译
pub fn align(tokens: &[ReadingToken], existing: &str) -> Option<TrackResult> {
    if !latin_only(existing) {
        return None;
    }
    static DOUBLES: LazyLock<Regex> = LazyLock::new(|| Regex::new("kk|ss|tt|cc|pp").unwrap());
    static EXPAND: LazyLock<Regex> = LazyLock::new(|| Regex::new("([kgnhbpmr])y([auo])").unwrap());
    static LONG_O: LazyLock<Regex> = LazyLock::new(|| Regex::new("oo|ou").unwrap());
    let mut groups: Vec<Group> = Vec::new();
    let mut leading = None;
    for token in tokens {
        let unresolved = UNRESOLVED.is_match(&token.reading);
        if unresolved && !HAN_ONLY.is_match(&token.text) {
            return None;
        }
        let mut readings = Vec::new();
        if !unresolved {
            for reading in token
                .readings
                .as_ref()
                .unwrap_or(&vec![token.reading.clone()])
            {
                let value = normalize(reading).text;
                if !CJK.is_match(&token.text) {
                    if !value.is_empty() {
                        push_unique(&mut readings, value);
                    }
                    continue;
                }
                for v in [
                    value.clone(),
                    value.replace("oo", "ou"),
                    value.replace("ou", "oo"),
                    LONG_O.replace_all(&value, "o").into_owned(),
                ] {
                    for spelling in [
                        v.clone(),
                        DOUBLES
                            .replace_all(&v, |c: &regex::Captures| c[0][..1].to_string())
                            .into_owned(),
                    ] {
                        let expanded = EXPAND.replace_all(&spelling, "${1}iy${2}").into_owned();
                        let expanded = expanded
                            .replace("sha", "xiya")
                            .replace("shu", "xiyu")
                            .replace("sho", "xiyo")
                            .replace("cha", "qiya")
                            .replace("chu", "qiyu")
                            .replace("cho", "qiyo")
                            .replace("ja", "jiya")
                            .replace("ju", "jiyu")
                            .replace("jo", "jiyo")
                            .replace("si", "xi")
                            .replace("ti", "qi")
                            .replace("tu", "cu");
                        for r in [
                            spelling.clone(),
                            spelling.replace('r', "l"),
                            expanded.clone(),
                            expanded.replace('r', "l"),
                        ] {
                            if !r.is_empty() {
                                push_unique(&mut readings, r);
                            }
                        }
                    }
                }
            }
        }
        if token.text == "っ" || token.text == "ッ" {
            readings.push(String::new());
        }
        if readings.is_empty() && !HAN_ONLY.is_match(&token.text) {
            if WORD.is_match(&token.text) {
                return None;
            }
            if let Some(previous) = groups.last_mut() {
                previous.to = previous.to.max(token.to);
            } else {
                leading = Some(token.from);
            }
            continue;
        }
        groups.push(Group {
            text: token.text.clone(),
            readings,
            from: leading.take().unwrap_or(token.from),
            to: token.to,
            anchor_from: token.from,
            anchor_to: token.to,
        });
    }
    let target = normalize(existing);
    if groups.is_empty()
        || target.text.is_empty()
        || target.text.len() > 1024
        || groups.iter().any(|g| g.readings.len() > 32)
        || groups
            .iter()
            .flat_map(|g| &g.readings)
            .map(String::len)
            .sum::<usize>()
            > 4096
    {
        return None;
    }
    if groups.iter().any(|g| g.readings.is_empty()) {
        return anchors(&groups, &target, existing);
    }
    let width = target.text.len() + 1;
    let boundary_costs: Vec<f64> = (0..width)
        .map(|column| {
            if column > 0 && column < target.text.len() && existing.chars().any(char::is_whitespace)
            {
                let previous = target.offsets[column - 1];
                let end = previous + existing[previous..].chars().next().unwrap().len_utf8();
                if target.offsets[column] >= end
                    && !existing[end..target.offsets[column]]
                        .chars()
                        .any(char::is_whitespace)
                {
                    return 1.0 / 4096.0;
                }
            }
            0.0
        })
        .collect();
    let mut costs: Vec<f64> = (0..width).map(|i| i as f64).collect();
    let mut traces = Vec::new();
    for (index, group) in groups.iter().enumerate() {
        let mut best = vec![f64::INFINITY; width];
        let mut choices = vec![0; width];
        let mut variants = Vec::new();
        for (variant, reading) in group.readings.iter().enumerate() {
            let mut steps = vec![0u8; (reading.len() + 1) * width];
            let mut previous: Vec<f64> = costs
                .iter()
                .enumerate()
                .map(|(col, c)| {
                    c + if index > 0 { boundary_costs[col] } else { 0.0 }
                        + variant as f64 / 1048576.0
                })
                .collect();
            for row in 1..=reading.len() {
                let mut current = vec![0.0; width];
                current[0] = previous[0] + 1.0;
                for column in 1..width {
                    let matched = previous[column - 1]
                        + f64::from(
                            reading.as_bytes()[row - 1] != target.text.as_bytes()[column - 1],
                        );
                    let deletion = previous[column] + 1.0;
                    let insertion = current[column - 1] + 1.0;
                    current[column] = matched.min(deletion).min(insertion);
                    steps[row * width + column] = if current[column] == matched {
                        0
                    } else if current[column] == deletion {
                        1
                    } else {
                        2
                    };
                }
                previous = current;
            }
            for column in 0..width {
                if previous[column] < best[column] {
                    best[column] = previous[column];
                    choices[column] = variant;
                }
            }
            variants.push(steps);
        }
        costs = best;
        traces.push((choices, variants));
    }
    let mut starts = vec![0; groups.len()];
    let mut coverage = vec![0.0; groups.len()];
    let mut column = target.text.len();
    let mut edits = 0;
    let mut length = 0;
    for index in (0..groups.len()).rev() {
        let (choices, variants) = &traces[index];
        let variant = choices[column];
        let reading = &groups[index].readings[variant];
        let steps = &variants[variant];
        let mut row = reading.len();
        let mut first = None;
        let mut exact = 0;
        length += row;
        if row == 0 {
            starts[index] = column;
            coverage[index] = 1.0;
            continue;
        }
        while row > 0 {
            match if column > 0 {
                steps[row * width + column]
            } else {
                1
            } {
                0 => {
                    column -= 1;
                    row -= 1;
                    first = Some(column);
                    if reading.as_bytes()[row] == target.text.as_bytes()[column] {
                        exact += 1;
                    } else {
                        edits += 1;
                    }
                }
                1 => {
                    row -= 1;
                    edits += 1;
                }
                _ => {
                    column -= 1;
                    edits += 1;
                }
            }
        }
        let Some(first) = first else {
            return anchors(&groups, &target, existing);
        };
        coverage[index] = exact as f64 / reading.len() as f64;
        starts[index] = first;
    }
    let score = 1.0 - (edits + column) as f64 / length.max(target.text.len()) as f64;
    if score < 0.8 {
        return anchors(&groups, &target, existing);
    }
    let uncertain: Vec<usize> = coverage
        .iter()
        .enumerate()
        .filter_map(|(i, r)| (*r < 0.7).then_some(i))
        .collect();
    for &index in &uncertain {
        if uncertain.len() > 1
            || groups[index].anchor_from != groups[index].anchor_to
            || !HAN.is_match(&groups[index].text)
            || index < 2
            || index + 2 >= groups.len()
            || coverage[index - 2..index].iter().any(|r| *r != 1.0)
            || coverage[index + 1..index + 3].iter().any(|r| *r != 1.0)
        {
            return anchors(&groups, &target, existing);
        }
    }
    let boundaries: Vec<usize> = starts
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if i == 0 {
                0
            } else {
                boundary(&target, existing, *p)
            }
        })
        .collect();
    let mut parts: Vec<Part> = Vec::new();
    for (index, group) in groups.iter().enumerate() {
        let start = boundaries[index];
        let end = boundaries.get(index + 1).copied().unwrap_or(existing.len());
        let merge = parts.last().is_some_and(|p| {
            !WORD.is_match(&p.text)
                || group.from <= p.to
                || start == end
                || (starts[index] > 0
                    && target.offsets.get(starts[index]) == target.offsets.get(starts[index] - 1))
        });
        if merge {
            let previous = parts.last_mut().unwrap();
            previous.text.push_str(&existing[start..end]);
            previous.to = previous.to.max(group.to);
        } else {
            parts.push(Part {
                text: existing[start..end].to_string(),
                from: group.from,
                to: group.to,
            });
        }
    }
    if parts.iter().all(|p| !p.text.trim().is_empty()) {
        Some(TrackResult { parts, score })
    } else {
        anchors(&groups, &target, existing)
    }
}

/// 通过唯一的完整读音上下文锚定单个未知汉字，拒绝歧义或缺词
/// @param groups - 候选读音及时间锚点
/// @param target - 规范化音译
/// @param existing - 原始音译
fn anchors(groups: &[Group], target: &Normalized, existing: &str) -> Option<TrackResult> {
    let unresolved: Vec<usize> = groups
        .iter()
        .enumerate()
        .filter_map(|(i, g)| g.readings.is_empty().then_some(i))
        .collect();
    let candidates: Vec<usize> = groups
        .iter()
        .enumerate()
        .filter_map(|(i, g)| {
            (g.anchor_from == g.anchor_to
                && HAN_ONLY.is_match(&g.text)
                && (unresolved.is_empty() || unresolved[0] == i))
                .then_some(i)
        })
        .collect();
    if candidates.is_empty() || unresolved.len() > 1 {
        return None;
    }
    let length = target.text.len();
    let width = length + 1;
    let mut prefix = vec![vec![0u8; width]];
    let mut pc = vec![vec![f64::INFINITY; width]];
    prefix[0][0] = 1;
    pc[0][0] = 0.0;
    for (index, group) in groups.iter().enumerate() {
        let mut next = vec![0u8; width];
        let mut costs = vec![f64::INFINITY; width];
        for start in 0..width {
            if prefix[index][start] == 0 {
                continue;
            }
            for reading in &group.readings {
                let end = start + reading.len();
                if end > length || !target.text[start..].starts_with(reading) {
                    continue;
                }
                let cost = pc[index][start] + f64::from(reading.is_empty());
                if cost < costs[end] {
                    costs[end] = cost;
                    next[end] = prefix[index][start];
                } else if cost == costs[end] {
                    next[end] = 2.min(next[end] + prefix[index][start]);
                }
            }
        }
        prefix.push(next);
        pc.push(costs);
    }
    let mut suffix = vec![vec![0u8; width]; groups.len() + 1];
    let mut sc = vec![vec![f64::INFINITY; width]; groups.len() + 1];
    suffix[groups.len()][length] = 1;
    sc[groups.len()][length] = 0.0;
    for index in (0..groups.len()).rev() {
        for start in 0..width {
            for reading in &groups[index].readings {
                let end = start + reading.len();
                if end > length
                    || suffix[index + 1][end] == 0
                    || !target.text[start..].starts_with(reading)
                {
                    continue;
                }
                let cost = sc[index + 1][end] + f64::from(reading.is_empty());
                if cost < sc[index][start] {
                    sc[index][start] = cost;
                    suffix[index][start] = suffix[index + 1][end];
                } else if cost == sc[index][start] {
                    suffix[index][start] = 2.min(suffix[index][start] + suffix[index + 1][end]);
                }
            }
        }
    }
    let mut plan = None;
    for index in candidates {
        let known = groups
            .iter()
            .enumerate()
            .filter(|(i, g)| {
                *i != index && !g.readings.is_empty() && g.text != "っ" && g.text != "ッ"
            })
            .count();
        let anchored = groups[index].readings.is_empty() && known >= 4;
        let limit = length as f64 * if anchored { 0.5 } else { 0.2 };
        for (start, prefix_count) in prefix[index].iter().enumerate().take(length) {
            if prefix[index][start] == 0
                || (start > 0 && target.offsets[start] == target.offsets[start - 1])
            {
                continue;
            }
            for (end, suffix_count) in suffix[index + 1]
                .iter()
                .enumerate()
                .take(length + 1)
                .skip(start + 1)
            {
                if (end - start) as f64 > limit {
                    break;
                }
                if suffix[index + 1][end] == 0
                    || (end < length && target.offsets[end] == target.offsets[end - 1])
                {
                    continue;
                }
                if plan.is_some() || *prefix_count > 1 || *suffix_count > 1 {
                    return None;
                }
                let score = (1.0 - (end - start) as f64 / length as f64).max(if anchored {
                    known as f64 / (known + 1) as f64
                } else {
                    0.0
                });
                plan = Some((index, start, end, score));
            }
        }
    }
    let (index, start, end, score) = plan?;
    let mut starts = vec![0; groups.len()];
    starts[index] = start;
    let mut cursor = start;
    for i in (0..index).rev() {
        let reading = groups[i].readings.iter().find(|r| {
            cursor >= r.len()
                && prefix[i][cursor - r.len()] > 0
                && pc[i][cursor - r.len()] + f64::from(r.is_empty()) == pc[i + 1][cursor]
                && target.text[cursor - r.len()..].starts_with(r.as_str())
        })?;
        cursor -= reading.len();
        starts[i] = cursor;
    }
    cursor = end;
    for i in index + 1..groups.len() {
        starts[i] = cursor;
        let reading = groups[i].readings.iter().find(|r| {
            cursor + r.len() <= length
                && suffix[i + 1][cursor + r.len()] > 0
                && sc[i + 1][cursor + r.len()] + f64::from(r.is_empty()) == sc[i][cursor]
                && target.text[cursor..].starts_with(r.as_str())
        })?;
        cursor += reading.len();
    }
    let boundaries: Vec<usize> = starts
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if i == 0 {
                0
            } else {
                boundary(target, existing, *p)
            }
        })
        .collect();
    let mut parts: Vec<Part> = Vec::new();
    for (i, g) in groups.iter().enumerate() {
        let text =
            &existing[boundaries[i]..boundaries.get(i + 1).copied().unwrap_or(existing.len())];
        if parts
            .last()
            .is_some_and(|p| g.from <= p.to || !WORD.is_match(text) || !WORD.is_match(&p.text))
        {
            let p = parts.last_mut().unwrap();
            p.text.push_str(text);
            p.to = p.to.max(g.to);
        } else {
            parts.push(Part {
                text: text.to_string(),
                from: g.from,
                to: g.to,
            });
        }
    }
    parts
        .iter()
        .all(|p| !p.text.trim().is_empty())
        .then_some(TrackResult { parts, score })
}
