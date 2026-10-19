use crate::text::{push_unique, CJK, HAN, KANA, WORD};
use crate::types::{Phrase, ReadingToken, SourceLine};
use anyhow::{ensure, Result};
use icu_segmenter::WordSegmenter;
use lindera::{dictionary::load_dictionary, mode::Mode, segmenter::Segmenter};
use regex::Regex;
use std::{borrow::Cow, collections::HashMap, sync::LazyLock};
use unicode_normalization::UnicodeNormalization;
use wana_kana::ConvertJapanese;

pub struct Linguistics {
    japanese: Option<Segmenter>,
    compatibility: Option<DictionaryCompatibility>,
}

#[derive(serde::Deserialize)]
struct DictionaryCompatibility {
    readings: HashMap<String, Vec<String>>,
    ties: HashMap<String, [String; 2]>,
}

#[derive(Clone)]
struct Piece {
    text: String,
    reading: String,
    pronunciation: String,
    start: usize,
    end: usize,
    features: Vec<String>,
}
struct KanaToken {
    text: String,
    readings: Vec<String>,
    from: usize,
    to: usize,
}

impl Linguistics {
    /// 按本次请求按需加载 IPADIC，词典随工作进程释放
    /// @param japanese - 是否存在需要日语词典的文字
    pub fn new(japanese: bool) -> Result<Self> {
        let japanese = if japanese {
            let mut segmenter =
                Segmenter::new(Mode::Normal, load_dictionary("embedded://ipadic")?, None);
            segmenter.keep_whitespace = true;
            segmenter.unknown_word_ladder = false;
            Some(segmenter)
        } else {
            None
        };
        let compatibility = if japanese.is_some() {
            Some(serde_json::from_reader(flate2::read::GzDecoder::new(
                &include_bytes!("../data/ipadic-compat.json.gz")[..],
            ))?)
        } else {
            None
        };
        Ok(Self {
            japanese,
            compatibility,
        })
    }

    /// 收集完整词典表记的候选读音，沿用 IPADIC 读音与发音字段
    /// @param spelling - 必须完整命中的表记
    fn dictionary_readings(&self, spelling: &str) -> Vec<String> {
        if let Some(values) = self
            .compatibility
            .as_ref()
            .and_then(|data| data.readings.get(spelling))
        {
            return values.iter().take(16).cloned().collect();
        }
        let mut readings = Vec::new();
        if let Some(segmenter) = &self.japanese {
            for entry in segmenter
                .dictionary
                .prefix_dictionary
                .find_surface(spelling)
            {
                let details = segmenter
                    .dictionary
                    .word_details(entry.word_id().id() as usize);
                for index in [7, 8] {
                    if let Some(value) = details.get(index).filter(|v| !v.is_empty() && **v != "*")
                    {
                        push_unique(&mut readings, (*value).to_string());
                    }
                }
            }
        }
        readings.truncate(16);
        readings
    }

    /// 提取语义词元、读音及语言学短语，所有范围均关联真实主歌词字词
    /// @param line - 原文字词、注音和已有辅助文本
    /// @param translation - 是否需要翻译短语
    pub fn tokenize(
        &self,
        line: &SourceLine,
        translation: bool,
    ) -> Result<(Vec<ReadingToken>, Vec<ReadingToken>, Vec<Phrase>)> {
        let text = line.words.join("");
        let mut offset = 0;
        let ranges: Vec<_> = line
            .words
            .iter()
            .enumerate()
            .map(|(index, w)| {
                let start = offset;
                offset += w.len();
                (start, offset, index)
            })
            .collect();
        let japanese = CJK.is_match(&text);
        let pieces =
            if let Some(segmenter) = self.japanese.as_ref().filter(|_| japanese) {
                segmenter
                    .segment(Cow::Borrowed(&text))?
                    .into_iter()
                    .map(|mut token| {
                        let mut features: Vec<String> =
                            token.details().into_iter().map(str::to_string).collect();
                        let surface = token.surface.to_string();
                        if let Some(entry) = segmenter
                            .dictionary
                            .prefix_dictionary
                            .find_surface(&surface)
                            .into_iter()
                            .find(|entry| entry.word_id() == token.word_id)
                        {
                            let mut key = vec![
                                serde_json::json!(entry.word_cost()),
                                serde_json::json!(surface),
                            ];
                            key.extend(
                                features
                                    .iter()
                                    .take(7)
                                    .map(|value| serde_json::json!(value)),
                            );
                            if let Some(values) = self.compatibility.as_ref().and_then(|data| {
                                data.ties.get(&serde_json::to_string(&key).unwrap())
                            }) {
                                features[7] = values[0].clone();
                                features[8] = values[1].clone();
                            }
                        }
                        let reading = features
                            .get(7)
                            .filter(|v| v.as_str() != "*")
                            .cloned()
                            .or_else(|| features.get(8).filter(|v| v.as_str() != "*").cloned())
                            .unwrap_or_else(|| surface.clone());
                        Piece {
                            text: surface,
                            reading,
                            pronunciation: features
                                .get(8)
                                .filter(|v| v.as_str() != "*")
                                .cloned()
                                .unwrap_or_default(),
                            start: token.byte_start,
                            end: token.byte_end,
                            features,
                        }
                    })
                    .collect::<Vec<_>>()
            } else {
                let segmenter = WordSegmenter::new_auto(Default::default());
                let boundaries: Vec<_> = segmenter.segment_str(&text).collect();
                boundaries
                    .windows(2)
                    .map(|r| Piece {
                        text: text[r[0]..r[1]].to_string(),
                        reading: text[r[0]..r[1]].to_string(),
                        pronunciation: String::new(),
                        start: r[0],
                        end: r[1],
                        features: Vec::new(),
                    })
                    .collect()
            };
        let mut source = Vec::new();
        let mut kana: Vec<KanaToken> = Vec::new();
        let mut cursor = 0;
        static RUNS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{Han}+|\P{Han}+").unwrap());
        static KANJI_NUMBER: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"[\p{Han}\p{N}]").unwrap());
        static SMALL: LazyLock<Regex> =
            LazyLock::new(|| Regex::new("^[ゃゅょぁぃぅぇぉャュョァィゥェォー]").unwrap());
        for piece in &pieces {
            let start = cursor
                + text[cursor..]
                    .find(&piece.text)
                    .ok_or_else(|| anyhow::anyhow!("日语分词与原文不一致"))?;
            cursor = start + piece.text.len();
            let covered: Vec<_> = ranges
                .iter()
                .filter(|(a, b, _)| *a < cursor && *b > start)
                .collect();
            if piece.text.trim().is_empty() || covered.is_empty() {
                continue;
            }
            let chars: Vec<_> = piece.text.char_indices().collect();
            let rchars: Vec<_> = piece.reading.char_indices().collect();
            let half = chars.get(chars.len() / 2).map_or(0, |v| v.0);
            let rh = rchars.get(rchars.len() / 2).map_or(0, |v| v.0);
            let repeated = japanese
                && chars.len() >= 4
                && chars.len() % 2 == 0
                && rchars.len() % 2 == 0
                && piece.text.chars().all(|c| CJK.is_match(&c.to_string()))
                && piece.text[..half] == piece.text[half..]
                && piece.reading[..rh] == piece.reading[rh..];
            for part in 0..if repeated { 2 } else { 1 } {
                let from = start + if repeated { part * half } else { 0 };
                let to = if repeated { from + half } else { cursor };
                let timed: Vec<_> = covered
                    .iter()
                    .filter(|(a, b, _)| *a < to && *b > from)
                    .collect();
                source.push(ReadingToken {
                    text: if repeated {
                        piece.text[part * half..(part + 1) * half].to_string()
                    } else {
                        piece.text.clone()
                    },
                    reading: if repeated {
                        piece.reading[part * rh..(part + 1) * rh].to_romaji()
                    } else {
                        piece.reading.to_romaji()
                    },
                    readings: None,
                    from: timed[0].2,
                    to: timed.last().unwrap().2,
                });
            }
            if !japanese {
                let token = source.last().unwrap();
                kana.push(KanaToken {
                    text: token.text.clone(),
                    readings: vec![piece.reading.clone()],
                    from: token.from,
                    to: token.to,
                });
                continue;
            }
            let runs: Vec<&str> = RUNS.find_iter(&piece.text).map(|m| m.as_str()).collect();
            let pattern = runs
                .iter()
                .map(|r| {
                    if HAN.is_match(r) {
                        "(.+?)".to_string()
                    } else {
                        format!("({})", regex::escape(&r.to_hiragana()))
                    }
                })
                .collect::<String>();
            let pattern = Regex::new(&format!("^{pattern}$"))?;
            let hiragana = piece.reading.to_hiragana();
            let matched = pattern.captures(&hiragana);
            let active = if matched.is_some() {
                runs
            } else {
                vec![piece.text.as_str()]
            };
            let mut position = start;
            for (index, run) in active.iter().enumerate() {
                let end = position + run.len();
                let words: Vec<_> = ranges
                    .iter()
                    .filter(|(a, b, _)| *a < end && *b > position)
                    .collect();
                let has_kanji = KANJI_NUMBER.is_match(run);
                let hinted = has_kanji
                    && words.iter().all(|(a, b, i)| {
                        line.readings
                            .as_ref()
                            .and_then(|r| r.get(*i))
                            .is_some_and(|v| !v.is_empty())
                            && *a >= position
                            && *b <= end
                    });
                let chunks: Vec<_> = if !has_kanji || hinted {
                    words
                        .iter()
                        .map(|(a, b, i)| (position.max(*a), end.min(*b), *i, *i))
                        .collect()
                } else {
                    vec![(position, end, words[0].2, words.last().unwrap().2)]
                };
                for (a, b, from, to) in chunks {
                    let surface = &text[a..b];
                    let reading = if hinted {
                        line.readings.as_ref().unwrap()[from].clone()
                    } else if has_kanji {
                        matched
                            .as_ref()
                            .and_then(|m| m.get(index + 1))
                            .map_or_else(|| piece.reading.clone(), |m| m.as_str().to_string())
                    } else {
                        surface.to_string()
                    };
                    if SMALL.is_match(surface) && !kana.is_empty() {
                        let previous = kana.last_mut().unwrap();
                        previous.text.push_str(surface);
                        for value in &mut previous.readings {
                            value.push_str(&reading);
                        }
                        previous.to = to;
                    } else {
                        let mut readings = vec![reading];
                        if a == start && b == cursor && !piece.pronunciation.is_empty() {
                            push_unique(&mut readings, piece.pronunciation.clone());
                        }
                        if has_kanji {
                            for r in self.dictionary_readings(surface) {
                                push_unique(&mut readings, r);
                            }
                            if matched.is_some() && a == position && b == end {
                                for r in self.dictionary_readings(&piece.text) {
                                    if let Some(value) =
                                        pattern.captures(&r.to_hiragana()).and_then(|m| {
                                            m.get(index + 1).map(|v| v.as_str().to_string())
                                        })
                                    {
                                        push_unique(&mut readings, value);
                                    }
                                }
                            }
                        }
                        kana.push(KanaToken {
                            text: surface.to_string(),
                            readings,
                            from,
                            to,
                        });
                    }
                }
                position = end;
            }
        }
        static DIGITS: LazyLock<Regex> = LazyLock::new(|| Regex::new("^[0-9０-９]{1,4}$").unwrap());
        for token in &mut kana {
            if !DIGITS.is_match(&token.text)
                || line
                    .readings
                    .as_ref()
                    .is_some_and(|r| !r[token.from].is_empty())
            {
                continue;
            }
            let mut value: usize = token.text.nfkc().collect::<String>().parse()?;
            let mut spelling = String::new();
            for (unit, suffix) in [(1000, "千"), (100, "百"), (10, "十"), (1, "")] {
                let digit = value / unit;
                value %= unit;
                if digit > 0 {
                    if digit != 1 || unit == 1 {
                        spelling.push("〇一二三四五六七八九".chars().nth(digit).unwrap());
                    }
                    spelling.push_str(suffix);
                }
            }
            if spelling.is_empty() {
                spelling.push('〇');
            }
            token.readings.extend(self.dictionary_readings(&spelling));
        }
        static NEXT_COUNTER: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"^[\p{Han}つ]+$").unwrap());
        let mut index = 0;
        while index + 1 < kana.len() {
            let token = &kana[index];
            let next = &kana[index + 1];
            let c = token.text.chars().next().unwrap();
            if token.text.chars().count() != 1
                || !"0123456789０１２３４５６７８９〇一二三四五六七八九".contains(c)
                || !NEXT_COUNTER.is_match(&next.text)
                || line
                    .readings
                    .as_ref()
                    .is_some_and(|r| !r[token.from].is_empty())
                || self.japanese.is_none()
            {
                index += 1;
                continue;
            }
            let c = if c.is_ascii_digit() || ('０'..='９').contains(&c) {
                "〇一二三四五六七八九"
                    .chars()
                    .nth(token.text.nfkc().collect::<String>().parse::<usize>()?)
                    .unwrap()
            } else {
                c
            };
            let mut readings = self.dictionary_readings(&(c.to_string() + &next.text));
            if !readings.is_empty() {
                for first in &token.readings {
                    for second in &next.readings {
                        push_unique(&mut readings, first.clone() + second);
                    }
                }
                readings.truncate(16);
                let merged = KanaToken {
                    text: token.text.clone() + &next.text,
                    readings,
                    from: token.from,
                    to: next.to,
                };
                kana.splice(index..index + 2, [merged]);
            }
            index += 1;
        }
        static FOREIGN: LazyLock<Regex> =
            LazyLock::new(|| Regex::new("フ[ァィェォ]|[テデ]ィ|[トド]ゥ|ウ[ィェォ]").unwrap());
        static SMALL_VOWEL: LazyLock<Regex> = LazyLock::new(|| Regex::new("[ァィゥェォ]").unwrap());
        static LONG_VOWEL: LazyLock<Regex> =
            LazyLock::new(|| Regex::new("aa|ee|ii|oo|uu").unwrap());
        let phonetic = kana
            .iter()
            .enumerate()
            .map(|(index, token)| {
                let next = kana
                    .get(index + 1)
                    .and_then(|t| t.readings.first())
                    .map_or("", String::as_str);
                let mut readings = Vec::new();
                for reading in &token.readings {
                    let mut romaji = reading.to_romaji();
                    if reading.ends_with(['っ', 'ッ']) {
                        let suffix = next.to_romaji();
                        let contextual = (reading.clone() + next).to_romaji();
                        romaji = if suffix.is_empty() {
                            romaji + "t"
                        } else {
                            contextual[..contextual.len() - suffix.len()].to_string()
                        };
                        if reading.chars().count() > 1 {
                            push_unique(&mut readings, reading.to_romaji());
                        }
                    }
                    if !romaji.is_empty() {
                        push_unique(&mut readings, romaji.clone());
                    }
                    if SMALL_VOWEL.is_match(reading) {
                        let replaced =
                            FOREIGN.replace_all(reading, |c: &regex::Captures| match &c[0] {
                                "ファ" => "fa",
                                "フィ" => "fi",
                                "フェ" => "fe",
                                "フォ" => "fo",
                                "ティ" => "ti",
                                "ディ" => "di",
                                "トゥ" => "tu",
                                "ドゥ" => "du",
                                "ウィ" => "wi",
                                "ウェ" => "we",
                                "ウォ" => "wo",
                                _ => unreachable!(),
                            });
                        push_unique(&mut readings, replaced.to_romaji());
                        push_unique(
                            &mut readings,
                            reading.chars().map(|c| c.to_string().to_romaji()).collect(),
                        );
                    }
                    if reading == "ぢ" || reading == "ヂ" {
                        push_unique(&mut readings, "di".into());
                    }
                    if reading == "づ" || reading == "ヅ" {
                        push_unique(&mut readings, "du".into());
                    }
                    if reading.contains('ー') {
                        push_unique(
                            &mut readings,
                            LONG_VOWEL
                                .replace_all(&romaji, |c: &regex::Captures| c[0][..1].to_string())
                                .into_owned(),
                        );
                    }
                    if reading == "っ" || reading == "ッ" {
                        push_unique(&mut readings, "tsu".into());
                    }
                }
                if token.text == "を" || token.text == "ヲ" {
                    push_unique(&mut readings, "o".into());
                }
                if kana
                    .get(index.wrapping_sub(1))
                    .and_then(|t| t.readings.first())
                    .is_some_and(|r| r.ends_with(['っ', 'ッ']))
                {
                    for reading in readings.clone() {
                        if reading
                            .starts_with(|c| "bcdfghjklmpqrstvwxyzBCDFGHJKLMPQRSTVWXYZ".contains(c))
                        {
                            push_unique(&mut readings, reading[..1].to_string() + &reading);
                        }
                    }
                }
                ReadingToken {
                    text: token.text.clone(),
                    reading: readings.first().cloned().unwrap_or_default(),
                    readings: Some(readings),
                    from: token.from,
                    to: token.to,
                }
            })
            .collect();
        let mut groups: Vec<Vec<usize>> = Vec::new();
        let mut heads = Vec::new();
        let mut pending = Vec::new();
        let mut features = Vec::new();
        let mut position = 0;
        let japanese_phrases = translation && KANA.is_match(&text);
        if japanese_phrases {
            for token in &source {
                let start = position
                    + text[position..]
                        .find(&token.text)
                        .ok_or_else(|| anyhow::anyhow!("原词位置无效"))?;
                position = start + token.text.len();
                let piece = pieces
                    .iter()
                    .find(|p| p.start <= start && p.end >= position)
                    .ok_or_else(|| anyhow::anyhow!("原词词性无效"))?;
                features.push(piece);
            }
        }
        for (index, token) in source.iter().enumerate().filter(|_| translation) {
            if japanese_phrases{
                let current=features[index];let pos=current.features.first().map_or("",String::as_str);let detail=current.features.get(1).map_or("",String::as_str);
                let dependent=["助詞","助動詞","記号"].contains(&pos) || detail=="接尾" || (detail=="非自立" && pos!="名詞");
                if !dependent{heads.push(index);}
                let compound=index>0 && current.start!=features[index-1].start && pos=="動詞" && features[index-1].features.first().is_some_and(|p|p=="動詞")
                    && features[index-1].features.get(5).is_some_and(|p|p.starts_with("連用"));
                if !groups.is_empty() && (dependent || compound){groups.last_mut().unwrap().push(index);}
                else if dependent{pending.push(index);}else{pending.push(index);groups.push(std::mem::take(&mut pending));}
            }else if !WORD.is_match(&token.text) && !groups.is_empty(){groups.last_mut().unwrap().append(&mut pending);groups.last_mut().unwrap().push(index);}
            else if "a an the to of in on at for by with from into over under about after before as than and or but if is am are was were be been being have has had would could should can may might must do does did not".split(' ').any(|s|s==token.text.to_lowercase()){pending.push(index);}
            else{pending.push(index);groups.push(std::mem::take(&mut pending));if WORD.is_match(&token.text){heads.push(index);}}
        }
        if !pending.is_empty() {
            if let Some(group) = groups.last_mut() {
                group.append(&mut pending);
            } else {
                groups.push(pending);
            }
        }
        let phrases = groups
            .into_iter()
            .map(|indices| Phrase {
                text: indices
                    .iter()
                    .map(|i| source[*i].text.as_str())
                    .collect::<Vec<_>>()
                    .join(if japanese_phrases { "" } else { " " }),
                heads: indices
                    .iter()
                    .copied()
                    .filter(|i| heads.contains(i))
                    .collect(),
                lemmas: indices
                    .iter()
                    .map(|i| {
                        features
                            .get(*i)
                            .filter(|p| {
                                p.text == source[*i].text
                                    && p.features
                                        .first()
                                        .is_some_and(|pos| pos == "動詞" || pos == "形容詞")
                            })
                            .and_then(|p| p.features.get(6))
                            .filter(|s| s.as_str() != "*")
                            .cloned()
                            .unwrap_or_else(|| source[*i].text.clone())
                    })
                    .collect(),
                indices,
            })
            .collect();
        ensure!(source.len() <= 65536, "分词结果过长");
        Ok((source, phonetic, phrases))
    }
}

/// 使用 ICU 词边界保留译文中的空白、标点及完整字词
/// @param text - 已有译文
pub fn target_words(text: &str) -> Vec<String> {
    crate::segmentation::words(text)
}
