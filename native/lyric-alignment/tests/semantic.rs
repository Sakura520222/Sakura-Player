use lyric_alignment::{
    align, prepare,
    semantic::{expand, iter_max},
    types::{Phrase, Request},
};
use serde_json::Value;

/// 验证双向匹配的同分顺序及未覆盖词扩展，不依赖下载模型
#[test]
fn itermax_preserves_ties_and_small_matrices() {
    assert_eq!(
        iter_max(&[vec![0.95, 0.9], vec![0.9, 0.86]]),
        vec![vec![true, false], vec![false, false]]
    );
    assert_eq!(
        iter_max(&[vec![1.0, 1.0], vec![1.0, 1.0]]),
        vec![vec![true, false], vec![false, false]]
    );
    assert!(iter_max(&[]).is_empty());
    assert_eq!(
        iter_max(&[
            vec![1.0, 0.1, 0.1],
            vec![0.1, 1.0, 0.1],
            vec![0.1, 0.1, 1.0]
        ]),
        vec![
            vec![true, false, false],
            vec![false, true, false],
            vec![false, false, true]
        ]
    );
}

/// 助词不能作为第二个独立语义锚点，短语扩展只使用原词下标
#[test]
fn phrase_expansion_requires_two_heads() {
    let phrases: Vec<Phrase> = serde_json::from_value(serde_json::json!([
        {"text":"甲助词","indices":[0,1],"heads":[0]},
        {"text":"乙助词","indices":[2,3],"heads":[2]}
    ]))
    .unwrap();
    assert!(expand(&vec![[0, 0], [3, 1]], &phrases).is_empty());
    assert_eq!(
        expand(&vec![[0, 0], [2, 1]], &phrases),
        vec![[0, 0], [1, 0], [2, 1], [3, 1]]
    );
}

/// 核对旧版完整请求的原词边界、译文切片及语言学短语
#[test]
fn preparation_preserves_semantic_inputs() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/semantic.json")).unwrap();
    let request: Request = serde_json::from_value(fixture["request"].clone()).unwrap();
    let prepared = prepare(&request).unwrap();
    let mut failures = Vec::new();
    for (line, expected) in prepared.iter().zip(fixture["prepared"].as_array().unwrap()) {
        let actual = serde_json::json!({"source":line.source.iter().map(|t|serde_json::json!({"text":t.text,"from":t.from,"to":t.to})).collect::<Vec<_>>(),"target":line.target,"sourcePhrases":line.phrases});
        let expected = serde_json::json!({"source":expected["source"].as_array().unwrap().iter().map(|t|serde_json::json!({"text":t["text"],"from":t["from"],"to":t["to"]})).collect::<Vec<_>>(),"target":expected["target"],"sourcePhrases":expected["sourcePhrases"]});
        if actual != expected {
            failures.push(format!(
                "line {}\nexpected={expected}\nactual={actual}",
                line.id
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// 使用与旧版相同的真实权重逐行核对对齐文本和原词范围
#[test]
#[ignore = "需要设置 SAKURA_ALIGNMENT_MODEL_DIR 指向已校验的本地 mBERT 模型"]
fn real_model_preserves_translation_alignment() {
    let directory = std::env::var_os("SAKURA_ALIGNMENT_MODEL_DIR").expect("缺少本地模型目录");
    let fixture: Value = serde_json::from_str(include_str!("fixtures/semantic.json")).unwrap();
    let request: Request = serde_json::from_value(fixture["request"].clone()).unwrap();
    let response = align(&request, Some(std::path::Path::new(&directory))).unwrap();
    assert!(
        response.translation_error.is_none(),
        "{:?}",
        response.translation_error
    );
    let mut actual = serde_json::to_value(response.lines).unwrap();
    let mut expected = fixture["expected"].clone();
    for values in [&mut actual, &mut expected] {
        for line in values.as_array_mut().unwrap() {
            if let Some(track) = line.get_mut("translation") {
                track.as_object_mut().unwrap().remove("score");
            }
        }
    }
    assert_eq!(actual, expected);
    let model =
        lyric_alignment::semantic::SemanticModel::load(std::path::Path::new(&directory)).unwrap();
    let source = vec!["词".to_string(); 511];
    let phrases = vec![
        Phrase {
            text: "music".into(),
            indices: (0..256).collect(),
            heads: vec![0],
            lemmas: Vec::new(),
        },
        Phrase {
            text: "word".into(),
            indices: (256..511).collect(),
            heads: vec![256],
            lemmas: Vec::new(),
        },
    ];
    assert!(model
        .align(&source, &["音乐".into(), "字词".into()], &phrases)
        .unwrap()
        .iter()
        .all(Vec::is_empty));
}
