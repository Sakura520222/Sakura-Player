"""本地 SimAlign 桥接：只输出索引，不生成歌词或时间戳"""

import json
import os
import sys
import argparse


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
    aligner = SentenceAligner(model=os.path.abspath(options.model_dir), token_type="bpe", matching_methods="i", device="cpu")
    # 本地路径会选择 AutoTokenizer，显式沿用 SimAlign 原有 mBERT 的分词边界
    aligner.embed_loader.tokenizer = BertTokenizer.from_pretrained(options.model_dir, local_files_only=True)
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
        if any(sum(len(tokenizer.tokenize(word)) for word in words) + 2 > 512 for words in (source, target)):
            results.append({"id": line["id"], "pairs": []})
            continue
        with torch.inference_mode():
            pairs = aligner.get_word_aligns(source, target)["itermax"]
        results.append({"id": line["id"], "pairs": sorted(pairs)})
    print(json.dumps(results, ensure_ascii=False), file=output, flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
