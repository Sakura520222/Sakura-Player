use lyric_alignment::{pinyin, readings::Linguistics, romanization, translation};
use serde_json::Value;

/// 将旧版真实结果作为回归基线，核对完整文本、原词范围和匹配分数
#[test]
fn preserves_legacy_alignment_cases() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/compatibility.json")).unwrap();
    let linguistics = Linguistics::new(true).unwrap();
    let mut failures = Vec::new();
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let args = case["args"].as_array().unwrap();
        let actual = match case["operation"].as_str().unwrap() {
            "alignRomanization" => serde_json::to_value(romanization::align(
                &serde_json::from_value::<Vec<lyric_alignment::types::ReadingToken>>(
                    args[0].clone(),
                )
                .unwrap(),
                args[1].as_str().unwrap(),
            ))
            .unwrap(),
            "alignTranslation" => {
                let pairs = serde_json::from_value(args[2].clone());
                serde_json::to_value(pairs.ok().and_then(|pairs: Vec<[usize; 2]>| {
                    translation::align(
                        &serde_json::from_value::<Vec<lyric_alignment::types::ReadingToken>>(
                            args[0].clone(),
                        )
                        .unwrap(),
                        &serde_json::from_value::<Vec<String>>(args[1].clone()).unwrap(),
                        &pairs,
                    )
                }))
                .unwrap()
            }
            "pinyin" => serde_json::to_value(pinyin::align(
                &serde_json::from_value(args[0].clone()).unwrap(),
            ))
            .unwrap(),
            "tokenize" => {
                let (source, phonetic, _) = linguistics
                    .tokenize(&serde_json::from_value(args[0].clone()).unwrap(), false)
                    .unwrap();
                serde_json::json!({"source":source,"phonetic":phonetic})
            }
            _ => panic!("未知基线操作"),
        };
        if !equivalent(&actual, &case["result"]) {
            failures.push(format!(
                "case {index} {}\nargs={}\nexpected={}\nactual={actual}",
                case["operation"], case["args"], case["result"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} / {} cases differ:\n{}",
        failures.len(),
        fixture["cases"].as_array().unwrap().len(),
        failures.join("\n")
    );
}

/// JSON 数字按值比较，容许跨语言计算的最后一位舍入差异
/// @param actual - Rust 结果
/// @param expected - 旧版基线
fn equivalent(actual: &Value, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            (a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-12
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| equivalent(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, v)| b.get(k).is_some_and(|e| equivalent(v, e)))
        }
        _ => actual == expected,
    }
}
