use lyric_alignment::{
    align, romanization, segmentation,
    types::{ReadingToken, Request},
};

/// 构造最小的有效原生请求，验证与渲染 IPC 相同的资源限制
fn request() -> Request {
    serde_json::from_value(serde_json::json!({"requestId":"bounds","translation":false,"romanization":true,"lines":[{"id":0,"words":["君","と"],"translation":"","romanization":"kimi to"}]})).unwrap()
}

/// 注音数量、唯一行号、总字符和选择轨道均不能绕过 IPC 约束
#[test]
fn rejects_unbounded_or_ambiguous_requests() {
    let original = request();
    assert!(original.validate().is_ok());
    let mut value = original.clone();
    value.lines.push(value.lines[0].clone());
    assert!(value.validate().is_err());
    let mut value = original.clone();
    value.lines[0].readings = Some(vec!["きみ".into()]);
    assert!(value.validate().is_err());
    let mut value = original.clone();
    value.translation = false;
    value.romanization = false;
    assert!(value.validate().is_err());
    let mut value = original.clone();
    value.lines[0].words = vec!["a".repeat(1024); 64];
    assert!(value.validate().is_err());
    let mut value = original.clone();
    value.lines[0].words = vec!["🎵".repeat(513)];
    assert!(value.validate().is_err());
    let mut value = original;
    value.lines[0].id = 4_294_967_296;
    assert!(value.validate().is_ok());
}

/// 未安装模型时仍返回完整音译，翻译保持未修改并提供可操作诊断
#[test]
fn romanization_remains_available_without_model() {
    let mut value = request();
    value.translation = true;
    value.lines[0].translation = "与你".into();
    let result = align(&value, None).unwrap();
    assert!(result.translation_error.is_some());
    assert!(result.lines[0].translation.is_none());
    assert_eq!(
        result.lines[0]
            .romanization
            .as_ref()
            .unwrap()
            .parts
            .iter()
            .map(|p| p.text.as_str())
            .collect::<String>(),
        "kimi to"
    );
}

/// 规范化字符展开和尾部省略促音不得产生越界或丢失原始标点
#[test]
fn unicode_and_silent_tail_preserve_text() {
    let tokens = vec![
        ReadingToken {
            text: "い".into(),
            reading: "i".into(),
            readings: None,
            from: 0,
            to: 0,
        },
        ReadingToken {
            text: "っ".into(),
            reading: "t".into(),
            readings: Some(vec!["t".into()]),
            from: 1,
            to: 1,
        },
    ];
    if let Some(result) = romanization::align(&tokens, "i'") {
        assert_eq!(
            result
                .parts
                .iter()
                .map(|p| p.text.as_str())
                .collect::<String>(),
            "i'"
        );
    }
    for text in [
        "我不愿让你的善意终化作一场空",
        "将一切隔绝在外",
        "コンピューターと音楽",
        "ｺﾝﾋﾟｭｰﾀｰ 🎵",
        "か\u{3099}くせい",
    ] {
        assert_eq!(segmentation::words(text).join(""), text);
    }
}
