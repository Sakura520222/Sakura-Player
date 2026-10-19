use anyhow::{ensure, Context, Result};
use lyric_alignment::{align, semantic::SemanticModel, types::Request};
use std::{
    io::{Read, Write},
    path::PathBuf,
};

/// 启动独立歌词对齐进程，错误只写入 stderr，任务结束后释放词典和模型
fn main() {
    if let Err(error) = run() {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

/// 读取有界 JSON 请求或验证本地模型，标准输出只包含完整协议响应
fn run() -> Result<()> {
    let mut directory = None;
    let mut verify = false;
    let mut args = std::env::args_os().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--model-dir" {
            ensure!(directory.is_none(), "模型目录重复");
            directory = Some(PathBuf::from(args.next().context("缺少模型目录")?));
        } else if argument == "--verify" {
            ensure!(!verify, "验证选项重复");
            verify = true;
        } else {
            anyhow::bail!("未知工作进程参数");
        }
    }
    if verify {
        let model = SemanticModel::load(directory.as_deref().context("缺少模型目录")?)?;
        let pairs = model.variants(&["music".into()], &["音乐".into()], None)?;
        ensure!(pairs.iter().any(|p| !p.is_empty()), "模型推理验证失败");
        println!("{{\"ready\":true}}");
        return Ok(());
    }
    let mut input = Vec::new();
    std::io::stdin()
        .take(1024 * 1024 + 1)
        .read_to_end(&mut input)?;
    ensure!(input.len() <= 1024 * 1024, "对齐输入超过大小限制");
    let request: Request = serde_json::from_slice(&input).context("对齐请求格式无效")?;
    let response = align(&request, directory.as_deref())?;
    let output = serde_json::to_vec(&response)?;
    ensure!(output.len() <= 1024 * 1024, "对齐输出超过大小限制");
    std::io::stdout().write_all(&output)?;
    Ok(())
}
