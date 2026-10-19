use crate::types::Phrase;
use anyhow::{ensure, Context, Result};
use candle_core::{Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config, DTYPE};
use std::{collections::BTreeSet, path::Path};
use tokenizers::Tokenizer;

pub struct SemanticModel {
    model: BertModel,
    tokenizer: Tokenizer,
    pad: u32,
    cls: u32,
    sep: u32,
}
pub type Pairs = Vec<[usize; 2]>;
struct Vectors {
    values: Vec<Vec<f32>>,
    words: Vec<Vec<f32>>,
    subword_indices: Vec<usize>,
    indices: Vec<usize>,
}

impl SemanticModel {
    /// 从播放器校验过的本地资产加载 mBERT，仅计算 SimAlign 使用的第八层
    /// @param directory - 固定模型目录
    pub fn load(directory: &Path) -> Result<Self> {
        let mut config: Config =
            serde_json::from_slice(&std::fs::read(directory.join("config.json"))?)?;
        ensure!(
            config.num_hidden_layers >= 8 && config.hidden_size == 768,
            "对齐模型结构无效"
        );
        config.num_hidden_layers = 8;
        let device = Device::Cpu;
        let vb = VarBuilder::from_backend(
            Box::new(crate::model_file::ModelFile::open(
                &directory.join("model.safetensors"),
            )?),
            DTYPE,
            device,
        );
        // 固定旧权重沿用 TensorFlow 的 gamma/beta 名称，映射名称即可复用原文件
        let vb = vb.rename_f(|name| {
            name.replace("LayerNorm.weight", "LayerNorm.gamma")
                .replace("LayerNorm.bias", "LayerNorm.beta")
        });
        let model = BertModel::load(vb.pp("bert"), &config)?;
        let mut tokenizer =
            Tokenizer::from_file(directory.join("tokenizer.json")).map_err(anyhow::Error::msg)?;
        tokenizer
            .with_truncation(None)
            .map_err(anyhow::Error::msg)?;
        tokenizer.with_padding(None);
        let pad = tokenizer.token_to_id("[PAD]").context("模型缺少 PAD")?;
        let cls = tokenizer.token_to_id("[CLS]").context("模型缺少 CLS")?;
        let sep = tokenizer.token_to_id("[SEP]").context("模型缺少 SEP")?;
        Ok(Self {
            model,
            tokenizer,
            pad,
            cls,
            sep,
        })
    }

    /// 按子词、完整词及实词提取候选，复用同一次双语推理
    /// @param source - 原文分词或短语
    /// @param target - 保留原下标的译文切片
    /// @param heads - 实词下标，存在时返回第三组候选
    pub fn variants(
        &self,
        source: &[String],
        target: &[String],
        heads: Option<&[usize]>,
    ) -> Result<Vec<Pairs>> {
        let mut pieces = Vec::new();
        for side in [source, target] {
            let tokens = side
                .iter()
                .map(|word| {
                    self.tokenizer
                        .encode(word.as_str(), false)
                        .map(|v| v.get_ids().to_vec())
                        .map_err(anyhow::Error::msg)
                })
                .collect::<Result<Vec<_>>>()?;
            if tokens.iter().all(Vec::is_empty)
                || tokens.iter().map(Vec::len).sum::<usize>() + 2 > 512
            {
                return Ok(vec![Vec::new(); if heads.is_some() { 3 } else { 2 }]);
            }
            pieces.push(tokens);
        }
        let width = pieces
            .iter()
            .map(|p| p.iter().map(Vec::len).sum::<usize>() + 2)
            .max()
            .unwrap();
        let mut ids = Vec::new();
        let mut masks = Vec::new();
        for side in &pieces {
            let mut tokens = vec![self.cls];
            tokens.extend(side.iter().flatten());
            tokens.push(self.sep);
            let mut mask = vec![1u32; tokens.len()];
            tokens.resize(width, self.pad);
            mask.resize(width, 0);
            ids.push(tokens);
            masks.push(mask);
        }
        let input = Tensor::new(ids, &Device::Cpu)?;
        let mask = Tensor::new(masks, &Device::Cpu)?;
        let hidden = self
            .model
            .forward(&input, &input.zeros_like()?, Some(&mask))?
            .to_vec3::<f32>()?;
        let vectors: Vec<_> = pieces
            .iter()
            .enumerate()
            .map(|(side, tokens)| {
                let mut cursor = 1;
                let mut values = Vec::new();
                let mut words = Vec::new();
                let mut subword_indices = Vec::new();
                let mut indices = Vec::new();
                for (index, ids) in tokens.iter().enumerate() {
                    if ids.is_empty() {
                        continue;
                    }
                    let slices = &hidden[side][cursor..cursor + ids.len()];
                    cursor += ids.len();
                    let mut mean = vec![0f32; 768];
                    for vector in slices {
                        for (m, v) in mean.iter_mut().zip(vector) {
                            *m += v;
                        }
                    }
                    for m in &mut mean {
                        *m /= ids.len() as f32;
                    }
                    values.extend_from_slice(slices);
                    words.push(mean);
                    indices.push(index);
                    subword_indices.extend(std::iter::repeat_n(index, ids.len()));
                }
                Vectors {
                    values,
                    words,
                    subword_indices,
                    indices,
                }
            })
            .collect();
        let mut variants = vec![
            mapped_pairs(
                &vectors[0].values,
                &vectors[1].values,
                &vectors[0].subword_indices,
                &vectors[1].subword_indices,
                false,
                target,
            ),
            mapped_pairs(
                &vectors[0].words,
                &vectors[1].words,
                &vectors[0].indices,
                &vectors[1].indices,
                false,
                target,
            ),
        ];
        if let Some(heads) = heads {
            let positions: Vec<_> = vectors[0]
                .indices
                .iter()
                .enumerate()
                .filter(|(_, i)| heads.contains(i))
                .map(|(p, _)| p)
                .collect();
            if positions.is_empty() {
                variants.push(Vec::new());
            } else {
                let words: Vec<_> = positions
                    .iter()
                    .map(|p| vectors[0].words[*p].clone())
                    .collect();
                let indices: Vec<_> = positions.iter().map(|p| vectors[0].indices[*p]).collect();
                variants.push(mapped_pairs(
                    &words,
                    &vectors[1].words,
                    &indices,
                    &vectors[1].indices,
                    true,
                    target,
                ));
            }
        }
        Ok(variants)
    }

    /// 沿用子词、短语、词典基本形及实词扩展的旧候选优先级
    /// @param source - 原文语义词元
    /// @param target - 已有译文词元
    /// @param phrases - 原文词性组成的短语
    pub fn align(
        &self,
        source: &[String],
        target: &[String],
        phrases: &[Phrase],
    ) -> Result<Vec<Pairs>> {
        let heads: Vec<_> = phrases
            .iter()
            .flat_map(|p| p.heads.iter().copied())
            .collect();
        let mut variants = self.variants(source, target, Some(&heads))?;
        let head_pairs = variants.pop().unwrap();
        let word_pairs = variants.pop().unwrap();
        let pairs = variants.pop().unwrap();
        // 超长或空白输入在分词阶段已拒绝，短语候选不能绕过同一模型长度限制
        if pairs.is_empty() && word_pairs.is_empty() && head_pairs.is_empty() {
            return Ok(vec![pairs]);
        }
        let mut alternatives = Vec::new();
        if phrases.len() > 1 && phrases.len() < source.len() {
            let variants = self.variants(
                &phrases.iter().map(|p| p.text.clone()).collect::<Vec<_>>(),
                target,
                None,
            )?;
            for candidate in variants.iter().rev() {
                alternatives.push(
                    candidate
                        .iter()
                        .flat_map(|[from, to]| phrases[*from].indices.iter().map(|i| [*i, *to]))
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect(),
                );
            }
        }
        alternatives.push(word_pairs.clone());
        alternatives.push(expand(&pairs, phrases));
        let mut lemma = source.to_vec();
        for p in phrases {
            for (index, value) in p.indices.iter().zip(&p.lemmas) {
                lemma[*index] = value.clone();
            }
        }
        let (lemma_pairs, lemma_words, lemma_heads) = if phrases.len() > 1 && lemma != source {
            let mut v = self.variants(&lemma, target, Some(&heads))?;
            let h = v.pop().unwrap();
            let w = v.pop().unwrap();
            let p = v.pop().unwrap();
            (p, w, h)
        } else {
            (pairs.clone(), word_pairs, head_pairs.clone())
        };
        alternatives.extend([
            expand(&lemma_pairs, phrases),
            expand(&lemma_words, phrases),
            expand(&head_pairs, phrases),
            expand(&lemma_heads, phrases),
        ]);
        let mut unique = vec![pairs];
        for candidate in alternatives {
            if !candidate.is_empty() && !unique.contains(&candidate) {
                unique.push(candidate);
            }
        }
        Ok(unique)
    }
}

/// 计算余弦相似度并映射 IterMax 配对，保留双向实词补全规则
/// @param source - 原文词向量
/// @param target - 译文词向量
/// @param from - 原文索引映射
/// @param to - 译文索引映射
/// @param complete - 是否允许实词双向补全
/// @param original_target - 译文分词
fn mapped_pairs(
    source: &[Vec<f32>],
    target: &[Vec<f32>],
    from: &[usize],
    to: &[usize],
    complete: bool,
    original_target: &[String],
) -> Pairs {
    let normalized: Vec<Vec<Vec<f32>>> = [source, target]
        .iter()
        .map(|side| {
            side.iter()
                .map(|v| {
                    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
                    v.iter()
                        .map(|x| if norm > 0.0 { x / norm } else { *x })
                        .collect()
                })
                .collect()
        })
        .collect();
    let similarity: Vec<Vec<f64>> = normalized[0]
        .iter()
        .map(|a| {
            normalized[1]
                .iter()
                .map(|b| ((a.iter().zip(b).map(|(x, y)| x * y).sum::<f32>() + 1.0) / 2.0) as f64)
                .collect()
        })
        .collect();
    let mut alignment = iter_max(&similarity);
    if complete
        && source.len() == 2
        && target.len() == 2
        && alignment.iter().flatten().filter(|v| **v).count() == 1
        && to.iter().all(|i| original_target[*i].chars().count() > 1)
    {
        let row = (0..2).find(|i| !alignment[*i].iter().any(|v| *v)).unwrap();
        let col = (0..2).find(|j| !(0..2).any(|i| alignment[i][*j])).unwrap();
        if similarity[row][col] >= 0.9 * similarity[row][1 - col].max(similarity[1 - row][col]) {
            alignment[row][col] = true;
        }
    }
    alignment
        .iter()
        .enumerate()
        .flat_map(|(i, row)| {
            row.iter()
                .enumerate()
                .filter_map(move |(j, v)| v.then_some([from[i], to[j]]))
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

/// 复现 SimAlign 的双向最大值与一次未覆盖词扩展，同分取最先出现的位置
/// @param similarity - 已规范化的双语相似度矩阵
pub fn iter_max(similarity: &[Vec<f64>]) -> Vec<Vec<bool>> {
    if similarity.is_empty() || similarity[0].is_empty() {
        return Vec::new();
    }
    let m = similarity.len();
    let n = similarity[0].len();
    let rows: Vec<_> = similarity
        .iter()
        .map(|r| {
            r.iter()
                .enumerate()
                .fold(0, |best, (i, v)| if *v > r[best] { i } else { best })
        })
        .collect();
    let cols: Vec<_> = (0..n)
        .map(|j| {
            (0..m).fold(0, |best, i| {
                if similarity[i][j] > similarity[best][j] {
                    i
                } else {
                    best
                }
            })
        })
        .collect();
    let mut inter: Vec<Vec<bool>> = (0..m)
        .map(|i| (0..n).map(|j| rows[i] == j && cols[j] == i).collect())
        .collect();
    if m.min(n) <= 2 {
        return inter;
    }
    let empty_rows: Vec<_> = inter.iter().map(|r| !r.iter().any(|v| *v)).collect();
    let empty_cols: Vec<_> = (0..n).map(|j| !(0..m).any(|i| inter[i][j])).collect();
    if !empty_rows.iter().any(|v| *v) || !empty_cols.iter().any(|v| *v) {
        return inter;
    }
    let masked: Vec<Vec<f64>> = (0..m)
        .map(|i| {
            (0..n)
                .map(|j| {
                    similarity[i][j]
                        * (0.9 * f64::from(empty_rows[i]) + 0.9 * f64::from(empty_cols[j])).min(1.0)
                })
                .collect()
        })
        .collect();
    let rows: Vec<_> = masked
        .iter()
        .map(|r| {
            r.iter()
                .enumerate()
                .fold(0, |best, (i, v)| if *v > r[best] { i } else { best })
        })
        .collect();
    let cols: Vec<_> = (0..n)
        .map(|j| {
            (0..m).fold(0, |best, i| {
                if masked[i][j] > masked[best][j] {
                    i
                } else {
                    best
                }
            })
        })
        .collect();
    for i in 0..m {
        for j in 0..n {
            if rows[i] == j && cols[j] == i && (empty_rows[i] || empty_cols[j]) {
                inter[i][j] = true;
            }
        }
    }
    inter
}

/// 将实词扩展至所属短语，至少两个短语具有独立实词锚点才接受
/// @param pairs - 模型词对
/// @param phrases - 原文短语与语义中心
pub fn expand(pairs: &Pairs, phrases: &[Phrase]) -> Pairs {
    if phrases
        .iter()
        .filter(|p| pairs.iter().any(|[from, _]| p.heads.contains(from)))
        .count()
        < 2
    {
        return Vec::new();
    }
    pairs
        .iter()
        .flat_map(|[from, to]| {
            phrases.iter().find(|p| p.heads.contains(from)).map_or_else(
                || vec![[*from, *to]],
                |p| p.indices.iter().map(|i| [*i, *to]).collect(),
            )
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
