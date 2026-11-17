use anyhow::{ensure, Result};

pub struct TokenSpan {
    pub start: usize,
    pub end: usize,
    pub score: f64,
}

/// 推进一帧 CTC 状态，重复字母必须经过空白，回溯只在需要时记录
/// @param previous - 前一帧状态代价
/// @param tokens - 目标字音编号
/// @param emission - 当前帧对数概率
/// @param frame - 当前帧在整行中的下标
/// @param trace - 可选的当前帧回溯缓冲
/// @returns 当前帧状态代价
fn advance(
    previous: &[f32],
    tokens: &[usize],
    emission: &[f32],
    frame: usize,
    mut trace: Option<&mut [u8]>,
) -> Vec<f32> {
    let mut next = vec![f32::NEG_INFINITY; previous.len()];
    for state in 0..previous.len().min(2 * frame + 3) {
        let token = if state % 2 == 0 { 0 } else { tokens[state / 2] };
        let mut best = previous[state];
        let mut step = 0;
        if state > 0 && previous[state - 1] > best {
            best = previous[state - 1];
            step = 1;
        }
        if state > 1
            && state % 2 == 1
            && token != tokens[state / 2 - 1]
            && previous[state - 2] > best
        {
            best = previous[state - 2];
            step = 2;
        }
        next[state] = best + emission[token];
        if let Some(trace) = &mut trace {
            trace[state] = step;
        }
    }
    next
}

/// 分块保存检查点并重算回溯，长行不需要常驻完整时间乘字音矩阵
/// @param emissions - 完整行逐帧对数概率
/// @param labels - 每帧词表大小
/// @param tokens - 不含空白的目标字符编号
/// @returns 每个目标字符的实测帧范围
pub fn align(emissions: &[f32], labels: usize, tokens: &[usize]) -> Result<Vec<TokenSpan>> {
    ensure!(
        labels > 1 && emissions.len().is_multiple_of(labels),
        "声学矩阵无效"
    );
    let frames = emissions.len() / labels;
    ensure!(frames > 0 && !tokens.is_empty(), "字音或音频为空");
    ensure!(
        tokens.iter().all(|t| *t > 0 && *t < labels),
        "声学字符编号无效"
    );
    ensure!(
        emissions.iter().all(|v| v.is_finite()),
        "声学预测含无效数值"
    );
    let repeated = tokens.windows(2).filter(|p| p[0] == p[1]).count();
    ensure!(frames >= tokens.len() + repeated, "音频不足以覆盖全部字音");
    const BLOCK: usize = 1500;
    let states = tokens.len() * 2 + 1;
    let mut previous = vec![f32::NEG_INFINITY; states];
    previous[0] = 0.0;
    let mut checkpoints = Vec::with_capacity(frames.div_ceil(BLOCK));
    for (frame, emission) in emissions.chunks_exact(labels).enumerate() {
        if frame % BLOCK == 0 {
            checkpoints.push(previous.clone());
        }
        previous = advance(&previous, tokens, emission, frame, None);
    }
    let mut state = if previous[states - 1] > previous[states - 2] {
        states - 1
    } else {
        states - 2
    };
    ensure!(previous[state].is_finite(), "未找到完整字音路径");
    let mut spans: Vec<_> = tokens
        .iter()
        .map(|_| TokenSpan {
            start: frames,
            end: 0,
            score: 0.0,
        })
        .collect();
    for block in (0..checkpoints.len()).rev() {
        let start = block * BLOCK;
        let end = (start + BLOCK).min(frames);
        let mut trace = vec![0_u8; (end - start) * states];
        previous.clone_from(&checkpoints[block]);
        for frame in start..end {
            previous = advance(
                &previous,
                tokens,
                &emissions[frame * labels..(frame + 1) * labels],
                frame,
                Some(&mut trace[(frame - start) * states..(frame - start + 1) * states]),
            );
        }
        for frame in (start..end).rev() {
            if state % 2 == 1 {
                let span = &mut spans[state / 2];
                span.start = frame;
                span.end = span.end.max(frame + 1);
                span.score += f64::from(emissions[frame * labels + tokens[state / 2]]);
            }
            state -= usize::from(trace[(frame - start) * states + state]);
        }
    }
    for span in &mut spans {
        ensure!(span.end > span.start, "字音路径不完整");
        span.score = (span.score / (span.end - span.start) as f64)
            .exp()
            .clamp(0.0, 1.0);
    }
    Ok(spans)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造确定的字音与空白帧
    fn emissions(tokens: &[usize]) -> Vec<f32> {
        tokens
            .iter()
            .flat_map(|token| (0..3).map(move |t| if t == *token { -0.01 } else { -12.0 }))
            .collect()
    }

    #[test]
    fn repeated_tokens_require_blank_and_preserve_pause() {
        let result = align(&emissions(&[0, 1, 1, 0, 0, 1, 2, 2, 0]), 3, &[1, 1, 2]).unwrap();
        assert_eq!(
            result.iter().map(|s| (s.start, s.end)).collect::<Vec<_>>(),
            [(1, 3), (5, 6), (6, 8)]
        );
        assert!(align(&emissions(&[1, 1]), 3, &[1, 1]).is_err());
    }

    #[test]
    fn silence_and_wrong_text_have_low_acoustic_scores() {
        let result = align(&emissions(&[0, 0, 0, 0, 0]), 3, &[1, 2]).unwrap();
        assert!(result.iter().all(|s| s.score < 0.01));
        assert!(align(&[f32::NAN; 6], 3, &[1]).is_err());
    }

    #[test]
    fn long_lines_reconstruct_repeated_tokens_across_checkpoints() {
        let mut sequence = vec![0; 3005];
        sequence[1498] = 1;
        sequence[1499] = 1;
        sequence[1501] = 1;
        sequence[3001] = 2;
        let result = align(&emissions(&sequence), 3, &[1, 1, 2]).unwrap();
        assert_eq!(
            result.iter().map(|s| (s.start, s.end)).collect::<Vec<_>>(),
            [(1498, 1500), (1501, 1502), (3001, 3002)]
        );
    }
}
