use icu_collections::char16trie::{Char16Trie, TrieResult};
use icu_provider::prelude::*;
use icu_segmenter::{
    provider::{Baked, SegmenterDictionaryAutoV1},
    WordSegmenter,
};
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

/// 使用 ICU 词边界并复现 ICU4C 的中日文最小词频代价路径，保留所有原文本切片
/// @param text - 原文或已有译文
pub fn words(text: &str) -> Vec<String> {
    static CJK: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^[\p{Han}\p{Hiragana}\p{Katakana}ーｰﾞﾟ\u{3099}\u{309a}]+$").unwrap()
    });
    let segmenter = WordSegmenter::new_auto(Default::default());
    let boundaries: Vec<_> = segmenter.segment_str(text).collect();
    let mut result = Vec::new();
    let mut run = String::new();
    for range in boundaries.windows(2) {
        let word = &text[range[0]..range[1]];
        if CJK.is_match(word) {
            run.push_str(word);
        } else {
            if !run.is_empty() {
                result.extend(cjk(&run));
                run.clear();
            }
            result.push(word.to_string());
        }
    }
    if !run.is_empty() {
        result.extend(cjk(&run));
    }
    result
}

/// 在 ICU 同源词典上按词频寻找全局最优切分，避免贪心选词改变语义锚点
/// @param text - 连续的中日文字符
fn cjk(text: &str) -> Vec<String> {
    let response: DataResponse<SegmenterDictionaryAutoV1> = Baked
        .load(DataRequest {
            id: DataIdentifierBorrowed::for_marker_attributes(
                DataMarkerAttributes::from_str_or_panic("cjdict"),
            ),
            ..Default::default()
        })
        .expect("内置中日文词典完整");
    let dictionary = Char16Trie::new(response.payload.get().trie_data.clone());
    let grapheme = icu_segmenter::GraphemeClusterSegmenter::new();
    let boundaries: Vec<_> = grapheme.segment_str(text).collect();
    let mut normalized = String::new();
    let mut offsets = Vec::new();
    for range in boundaries.windows(2) {
        for c in text[range[0]..range[1]].nfkc() {
            normalized.push(c);
            offsets.push(range[0]);
        }
    }
    offsets.push(text.len());
    let chars: Vec<_> = normalized.char_indices().collect();
    let mut costs = vec![u32::MAX; chars.len() + 1];
    let mut previous = vec![0; chars.len() + 1];
    costs[0] = 0;
    let mut previous_katakana = false;
    for i in 0..chars.len() {
        let mut iter = dictionary.iter();
        let mut single = false;
        for (j, (_, c)) in chars.iter().enumerate().skip(i).take(20) {
            let matched = iter.next32((*c).into());
            if let TrieResult::Intermediate(value) | TrieResult::FinalValue(value) = matched {
                let cost = costs[i] + value as u32;
                if cost < costs[j + 1] {
                    costs[j + 1] = cost;
                    previous[j + 1] = i;
                }
                if j == i {
                    single = true;
                }
            }
            if matches!(matched, TrieResult::NoMatch | TrieResult::FinalValue(_)) {
                break;
            }
        }
        if !single && costs[i] + 255 < costs[i + 1] {
            costs[i + 1] = costs[i] + 255;
            previous[i + 1] = i;
        }
        let katakana = is_katakana(chars[i].1);
        if katakana && !previous_katakana {
            let length = chars[i..]
                .iter()
                .take(20)
                .take_while(|(_, c)| is_katakana(*c))
                .count();
            if length < 20 {
                let cost = costs[i]
                    + [8192, 984, 408, 240, 204, 252, 300, 372, 480]
                        .get(length)
                        .copied()
                        .unwrap_or(8192);
                if cost < costs[i + length] {
                    costs[i + length] = cost;
                    previous[i + length] = i;
                }
            }
        }
        previous_katakana = katakana;
    }
    let mut ranges = Vec::new();
    let mut end = chars.len();
    while end > 0 {
        let start = previous[end];
        ranges.push((offsets[start], offsets[end]));
        end = start;
    }
    ranges
        .into_iter()
        .rev()
        .filter(|(a, b)| a < b)
        .map(|(a, b)| text[a..b].to_string())
        .collect()
}

/// 判断 ICU4C 连续片假名代价规则覆盖的字符，间隔点仍作为独立边界
/// @param value - 规范化后的字符
fn is_katakana(value: char) -> bool {
    ('ァ'..='ヾ').contains(&value) && value != '・' || ('ｦ'..='ﾟ').contains(&value)
}
