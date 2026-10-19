"""本地 SimAlign 桥接：只输出索引，不生成歌词或时间戳"""

import json
import os
import sys
import argparse


def align_variants(aligner, source, target, heads=None):
    """复用一次嵌入推理，分别按子词和完整词提取配对
    @param aligner - 已加载本地模型的对齐器
    @param source - 本次推理的原文词元或语言学短语
    @param target - 保留原始下标的译文切片
    @param heads - 可独立表达语义的原文下标，用于排除助词抢占配对
    @returns 子词、完整词及可选实词配对，空白切片不参与平均
    """
    pieces = [
        [aligner.embed_loader.tokenizer.tokenize(word) for word in words]
        for words in (source, target)
    ]
    indices = [[index for index, tokens in enumerate(words) if tokens] for words in pieces]
    if any(not side for side in indices) or any(
        sum(map(len, side)) + 2 > 512 for side in pieces
    ):
        return [[], []] if heads is None else [[], [], []]
    tokens = [[pieces[side][index] for index in indices[side]] for side in range(2)]
    words = [
        [original[index] for index in indices[side]]
        for side, original in enumerate((source, target))
    ]
    vectors = aligner.embed_loader.get_embed_list(words).cpu().detach().numpy()
    vectors = [vectors[side, :sum(map(len, tokens[side]))] for side in range(2)]
    subword_indices = [
        [index for index, parts in zip(indices[side], tokens[side]) for _ in parts]
        for side in range(2)
    ]
    word_vectors = aligner.average_embeds_over_words(vectors, tokens)
    candidates = [
        (vectors, subword_indices),
        (word_vectors, indices),
    ]
    if heads is not None:
        positions = [position for position, index in enumerate(indices[0]) if index in heads]
        if positions:
            candidates.append((
                [word_vectors[0][positions], word_vectors[1]],
                [[indices[0][position] for position in positions], indices[1]],
            ))
    variants = []
    for variant, (embeddings, mapping) in enumerate(candidates):
        similarity = aligner.get_similarity(embeddings[0], embeddings[1])
        similarity = aligner.apply_distortion(similarity, aligner.distortion)
        alignment = aligner.iter_max(similarity)
        if (
            variant == 2
            and similarity.shape == (2, 2)
            and alignment.sum() == 1
            and all(len(word) > 1 for word in words[1])
        ):
            row = int((alignment.sum(axis=1) == 0).nonzero()[0][0])
            column = int((alignment.sum(axis=0) == 0).nonzero()[0][0])
            # 多字译文词须同时通过双向比较，避免把单字连接词补成独立语义锚点
            if similarity[row, column] >= 0.9 * max(
                similarity[row, 1 - column], similarity[1 - row, column]
            ):
                alignment[row, column] = 1
        rows, columns = alignment.nonzero()
        variants.append(sorted({
            (mapping[0][int(row)], mapping[1][int(column)])
            for row, column in zip(rows, columns)
        }))
    if heads is not None and len(variants) < 3:
        variants.append([])
    return variants


def expand_phrase_pairs(pairs, phrases):
    """将实词配对扩展到同一短语的活用和助词，保留其他已有配对
    @param pairs - 模型产生的原文与译文分词下标
    @param phrases - 保留原文下标与语义中心的短语
    @returns 只扩展原词范围、不生成译文或时间的配对
    """
    matched = {
        index
        for index, phrase in enumerate(phrases)
        if any(from_ in phrase.get("heads", []) for from_, _ in pairs)
    }
    if len(matched) < 2:
        return []
    heads = {
        head: phrase["indices"]
        for phrase in phrases
        for head in phrase.get("heads", [])
    }
    return sorted({
        (index, to)
        for from_, to in pairs
        for index in heads.get(from_, [from_])
    })


def main():
    """使用应用安装并校验的本地模型，验证和对齐均保持离线"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--verify", action="store_true")
    options = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    # 运行库随虚拟环境安装，避免依赖机器预装的 VC++ 组件
    if sys.platform == "win32":
        import ctypes
        _runtime_directory = os.add_dll_directory(sys.prefix)
        _runtime = ctypes.WinDLL(os.path.join(sys.prefix, "msvcp140.dll"))
    from simalign import SentenceAligner
    from transformers import BertTokenizer
    import torch

    torch.set_num_threads(2)
    # 推理日志不得进入 JSON 协议输出
    output = sys.stdout
    sys.stdout = sys.stderr
    aligner = SentenceAligner(
        model=os.path.abspath(options.model_dir),
        token_type="bpe",
        matching_methods="i",
        device="cpu",
    )
    # 本地路径会选择 AutoTokenizer，显式沿用 SimAlign 原有 mBERT 的分词边界
    aligner.embed_loader.tokenizer = BertTokenizer.from_pretrained(
        options.model_dir, local_files_only=True
    )
    if options.verify:
        with torch.inference_mode():
            pairs = aligner.get_word_aligns(["music"], ["音乐"])
        if "itermax" not in pairs:
            raise ValueError("模型推理验证失败")
        print(json.dumps({"ready": True}), file=output, flush=True)
        return
    request = json.loads(sys.stdin.buffer.read(1024 * 1024 + 1).decode("utf-8"))
    results = []
    for line in request:
        source, target = line["source"], line["target"]
        # 拒绝模型截断后的伪完整结果
        tokenizer = aligner.embed_loader.tokenizer
        if any(
            sum(len(tokenizer.tokenize(word)) for word in words) + 2 > 512
            for words in (source, target)
        ):
            results.append({"id": line["id"], "pairs": []})
            continue
        with torch.inference_mode():
            phrases = line.get("phrases", [])
            heads = [index for phrase in phrases for index in phrase.get("heads", [])]
            pairs, word_pairs, head_pairs = align_variants(aligner, source, target, heads)
            alternatives = []
            if 1 < len(phrases) < len(source):
                phrase_pairs, phrase_word_pairs = align_variants(
                    aligner, [phrase["text"] for phrase in phrases], target
                )
                for candidate in (phrase_word_pairs, phrase_pairs):
                    alternatives.append(sorted({
                        (index, to)
                        for from_, to in candidate
                        for index in phrases[from_]["indices"]
                    }))
            alternatives.append(word_pairs)
            alternatives.append(expand_phrase_pairs(pairs, phrases))
            lemma_source = source.copy()
            for phrase in phrases:
                for index, lemma in zip(phrase["indices"], phrase.get("lemmas", [])):
                    lemma_source[index] = lemma
            if len(phrases) > 1 and lemma_source != source:
                lemma_pairs, lemma_word_pairs, lemma_head_pairs = align_variants(
                    aligner, lemma_source, target, heads
                )
            else:
                lemma_pairs, lemma_word_pairs, lemma_head_pairs = pairs, word_pairs, head_pairs
            alternatives.append(expand_phrase_pairs(lemma_pairs, phrases))
            alternatives.append(expand_phrase_pairs(lemma_word_pairs, phrases))
            alternatives.append(expand_phrase_pairs(head_pairs, phrases))
            alternatives.append(expand_phrase_pairs(lemma_head_pairs, phrases))
        unique = []
        for candidate in alternatives:
            if candidate and candidate != pairs and candidate not in unique:
                unique.append(candidate)
        results.append({"id": line["id"], "pairs": pairs, "alternatives": unique})
    print(json.dumps(results, ensure_ascii=False, separators=(",", ":")), file=output, flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
