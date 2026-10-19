use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

pub static HAN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{Han}").unwrap());
pub static HAN_ONLY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{Han}+$").unwrap());
pub static KANA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\p{Hiragana}\p{Katakana}]").unwrap());
pub static CJK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\p{Han}\p{Hiragana}\p{Katakana}]").unwrap());
pub static UNRESOLVED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]").unwrap());
pub static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{L}\p{N}]").unwrap());
static NON_LATIN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\p{L}&&\P{scx:Latin}]").unwrap());

pub struct Normalized {
    pub text: String,
    pub offsets: Vec<usize>,
}

/// 检查音译是否只含拉丁字母，保留数字、空白和标点
/// @param text - 用户已有的音译
pub fn latin_only(text: &str) -> bool {
    !NON_LATIN.is_match(text)
}

/// 按插入顺序去重候选，维持旧算法的同分优先级
/// @param values - 当前候选
/// @param value - 新候选
pub fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.contains(&value) {
        values.push(value);
    }
}

/// 统一读音并保留 UTF-8 原文切片位置，不把字节下标当作字词下标
/// @param text - 候选读音或已有音译
pub fn normalize(text: &str) -> Normalized {
    let mut raw = String::new();
    let mut offsets = Vec::new();
    for (offset, ch) in text.char_indices() {
        let lower = ch.to_lowercase().next().unwrap();
        let value = match lower {
            'ā' | 'â' => "aa".to_string(),
            'ī' | 'î' => "ii".to_string(),
            'ū' | 'û' => "uu".to_string(),
            'ē' | 'ê' => "ee".to_string(),
            'ō' | 'ô' => "ou".to_string(),
            _ => ch.to_string(),
        };
        for c in value
            .nfkd()
            .flat_map(char::to_lowercase)
            .filter(|c| c.is_ascii_alphanumeric())
        {
            raw.push(c);
            offsets.push(offset);
        }
    }
    let mut normalized = Normalized {
        text: String::new(),
        offsets: Vec::new(),
    };
    let mut index = 0;
    while index < raw.len() {
        let matched = [
            ("shi", "si"),
            ("chi", "ti"),
            ("tsu", "tu"),
            ("ji", "zi"),
            ("fu", "hu"),
        ]
        .into_iter()
        .find(|(from, _)| raw[index..].starts_with(from));
        if let Some((from, to)) = matched {
            normalized.text.push_str(to);
            normalized.offsets.push(offsets[index]);
            normalized.offsets.push(offsets[index + from.len() - 1]);
            index += from.len();
        } else {
            normalized.text.push(raw.as_bytes()[index] as char);
            normalized.offsets.push(offsets[index]);
            index += 1;
        }
    }
    normalized
}

/// 将规范化匹配边界映射回原音译，撇号沿用后一个音节
/// @param target - 规范化音译及位置映射
/// @param existing - 原始音译
/// @param position - 规范化边界
pub fn boundary(target: &Normalized, existing: &str, position: usize) -> usize {
    let offset = target
        .offsets
        .get(position)
        .copied()
        .unwrap_or(existing.len());
    existing[..offset]
        .char_indices()
        .next_back()
        .filter(|(_, c)| matches!(c, '\'' | '’'))
        .map_or(offset, |(index, _)| index)
}
