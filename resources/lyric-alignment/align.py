"""本地 SimAlign 桥接：只输出索引，不生成歌词或时间戳"""

import json
import os
import sys
import argparse


def align_variants(aligner, source, target):
    """复用一次嵌入推理，分别按子词和完整词提取配对
    @param aligner - 已加载本地模型的对齐器
    @param source - 本次推理的原文词元或语言学短语
    @param target - 保留原始下标的译文切片
    @returns 子词和完整词配对，空白切片不参与词向量平均
    """
    pieces = [
        [aligner.embed_loader.tokenizer.tokenize(word) for word in words]
        for words in (source, target)
    ]
    indices = [[index for index, tokens in enumerate(words) if tokens] for words in pieces]
    if any(not side for side in indices) or any(
        sum(map(len, side)) + 2 > 512 for side in pieces
    ):
        return [], []
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
    variants = []
    for embeddings, mapping in (
        (vectors, subword_indices),
        (aligner.average_embeds_over_words(vectors, tokens), indices),
    ):
        similarity = aligner.get_similarity(embeddings[0], embeddings[1])
        similarity = aligner.apply_distortion(similarity, aligner.distortion)
        rows, columns = aligner.iter_max(similarity).nonzero()
        variants.append(sorted({
            (mapping[0][int(row)], mapping[1][int(column)])
            for row, column in zip(rows, columns)
        }))
    return variants


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
            pairs, word_pairs = align_variants(aligner, source, target)
            alternatives = []
            phrases = line.get("phrases", [])
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
