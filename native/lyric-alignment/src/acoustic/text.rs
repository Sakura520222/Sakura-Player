use crate::{readings::Linguistics, types::SourceLine};
use anyhow::{ensure, Result};
use pinyin::ToPinyin;
use unicode_normalization::UnicodeNormalization;
use wana_kana::ConvertJapanese;

pub struct Unit {
    pub text: String,
    pub tokens: Vec<usize>,
    pub uncertain: bool,
}

/// 将原文转换为声学字母，保留不可细分的日语汉字读音组和全部原始标点
/// @param text - 完整原文
/// @param language - 显式选择的原文语言
/// @param linguistics - 本次任务共用的日语词典
/// @returns 原文字词与声学字符的一一范围映射
pub fn prepare(text: &str, language: &str, linguistics: &Linguistics) -> Result<Vec<Unit>> {
    let chars: Vec<String> = text.chars().map(|c| c.to_string()).collect();
    let mut pieces: Vec<(String, String)> = match language {
        "ja" => {
            let source = SourceLine {
                id: 0,
                words: chars.clone(),
                readings: None,
                translation: String::new(),
                romanization: String::new(),
            };
            let (_, readings, _) = linguistics.tokenize(&source, false)?;
            let mut result = Vec::new();
            let mut cursor = 0;
            for reading in readings {
                ensure!(
                    reading.from >= cursor && reading.to < chars.len(),
                    "日语读音范围不完整"
                );
                if reading.from > cursor {
                    let gap = chars[cursor..reading.from].concat();
                    result.push((gap.clone(), gap));
                }
                result.push((chars[reading.from..=reading.to].concat(), reading.reading));
                cursor = reading.to + 1;
            }
            if cursor < chars.len() {
                let gap = chars[cursor..].concat();
                result.push((gap.clone(), gap));
            }
            result
        }
        "zh" => text
            .chars()
            .map(|c| {
                let reading = c
                    .to_pinyin()
                    .map_or_else(|| c.to_string(), |p| p.plain().to_string());
                (c.to_string(), reading)
            })
            .collect(),
        "en" => {
            let mut result: Vec<(String, String)> = Vec::new();
            let mut word = String::new();
            for c in text.chars() {
                if c.is_alphabetic() || matches!(c, '\'' | '’') {
                    word.push(c);
                } else {
                    if !word.is_empty() {
                        result.push((word.clone(), std::mem::take(&mut word)));
                    }
                    result.push((c.to_string(), c.to_string()));
                }
            }
            if !word.is_empty() {
                result.push((word.clone(), word));
            }
            result
        }
        _ => anyhow::bail!("尚未支持该声学对齐语言"),
    };
    if language == "ja" {
        let mut grouped: Vec<(String, String)> = Vec::new();
        let mut pending = String::new();
        for (surface, reading) in pieces {
            // 促音和长音不各自制造独立声学锚点，拗音与前一个假名共同发声
            if surface == "っ" || surface == "ッ" {
                pending.push_str(&surface);
                continue;
            }
            if surface
                .chars()
                .all(|c| "ゃゅょぁぃぅぇぉャュョァィゥェォー".contains(c))
            {
                if let Some((previous, pronunciation)) = grouped.last_mut() {
                    if surface != "ー"
                        && previous
                            .chars()
                            .all(|c| ('\u{3040}'..='\u{30ff}').contains(&c))
                    {
                        *pronunciation = (previous.clone() + &surface).to_romaji();
                    }
                    previous.push_str(&surface);
                    continue;
                }
            }
            grouped.push((std::mem::take(&mut pending) + &surface, reading));
        }
        if !pending.is_empty() {
            if let Some((surface, _)) = grouped.last_mut() {
                surface.push_str(&pending);
            }
        }
        pieces = grouped;
    }
    let mut units: Vec<Unit> = Vec::new();
    let mut prefix = String::new();
    let mut total = 0;
    for (surface, reading) in pieces {
        let normalized: String = reading
            .replace('’', "'")
            .nfkd()
            .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
            .flat_map(char::to_lowercase)
            .collect();
        // 未知读音使用模型通配符吸收音频，同时向预览返回估算警告
        let uncertain = normalized
            .chars()
            .any(|c| c.is_alphanumeric() && !c.is_ascii_alphabetic());
        let tokens: Vec<_> = normalized
            .chars()
            .filter_map(|c| {
                if c.is_alphanumeric() && !c.is_ascii_alphabetic() {
                    return Some(28);
                }
                "-aienout srmkldghybpwcvjzf'qx"
                    .replace(' ', "")
                    .chars()
                    .position(|label| label == c)
                    .filter(|id| *id > 0)
            })
            .collect();
        if tokens.is_empty() {
            if let Some(unit) = units.last_mut() {
                unit.text.push_str(&surface);
            } else {
                prefix.push_str(&surface);
            }
        } else {
            total += tokens.len();
            units.push(Unit {
                text: std::mem::take(&mut prefix) + &surface,
                tokens,
                uncertain,
            });
        }
    }
    ensure!(!units.is_empty() && total > 0, "没有可处理的字音");
    ensure!(
        units.iter().map(|u| u.text.as_str()).collect::<String>() == text,
        "读音映射未完整保留原文"
    );
    Ok(units)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_and_english_keep_spacing_and_punctuation() {
        let linguistics = Linguistics::new(false).unwrap();
        for (text, lang) in [(" 你好，世界！", "zh"), ("Don't stop, don't go!", "en")] {
            let units = prepare(text, lang, &linguistics).unwrap();
            assert_eq!(
                units.iter().map(|u| u.text.as_str()).collect::<String>(),
                text
            );
            assert!(units.len() >= 4);
        }
        assert!(prepare("hello 2026", "en", &linguistics)
            .unwrap()
            .iter()
            .any(|unit| unit.uncertain));
    }

    #[test]
    fn japanese_keeps_reading_groups_instead_of_dividing_kanji_evenly() {
        let linguistics = Linguistics::new(true).unwrap();
        for text in ["君のことが好き", "きっと、ずっと。", "東京へ行こう"] {
            let units = prepare(text, "ja", &linguistics).unwrap();
            assert_eq!(
                units.iter().map(|u| u.text.as_str()).collect::<String>(),
                text
            );
            assert!(units.iter().all(|u| !u.tokens.is_empty()));
        }
    }
}
