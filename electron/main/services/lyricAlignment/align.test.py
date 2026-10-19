"""使用固定相似度验证桥接边界，不加载模型或下载资源"""

import importlib.util
import os
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace

if sys.platform == "win32":
    import ctypes
    _directory = os.add_dll_directory(sys.prefix)
    _runtime = ctypes.WinDLL(os.path.join(sys.prefix, "msvcp140.dll"))

import numpy as np
import torch
from simalign import SentenceAligner

sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location(
    "bridge", Path(__file__).resolve().parents[4] / "resources/lyric-alignment/align.py"
)
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)


class FakeAligner:
    """固定完整词及实词矩阵，验证候选提取而不依赖模型权重"""

    def __init__(self, similarity):
        """保存待测实词矩阵
        @param similarity - 两个实词与两个译文词的相似度
        """
        self.similarity = np.array(similarity)
        self.distortion = 0
        self.calls = 0
        self.embed_loader = SimpleNamespace(
            tokenizer=SimpleNamespace(tokenize=lambda text: [text] if text.strip() else []),
            get_embed_list=self.embed,
        )

    def embed(self, words):
        """构造固定大小的词向量并记录推理次数
        @param words - 已去除空白词元的双语输入
        @returns 可供完整词平均使用的张量
        """
        self.calls += 1
        return torch.zeros((2, max(map(len, words)), 4))

    def get_similarity(self, source, target):
        """只为实词候选使用待测矩阵
        @param source - 原文词向量
        @param target - 译文词向量
        @returns 与候选大小一致的固定矩阵
        """
        if (len(source), len(target)) == (2, 2):
            return self.similarity.copy()
        return np.ones((len(source), len(target)))

    average_embeds_over_words = staticmethod(SentenceAligner.average_embeds_over_words)
    apply_distortion = staticmethod(SentenceAligner.apply_distortion)
    iter_max = staticmethod(SentenceAligner.iter_max)


class AlignmentTests(unittest.TestCase):
    """覆盖实词扩展、空白索引和截断拒绝"""

    def test_head_completion_requires_both_comparisons(self):
        """唯一未配对的实词必须同时接近两侧已有最佳分数"""
        strong = FakeAligner([[0.95, 0.9], [0.9, 0.86]])
        variants = bridge.align_variants(strong, ["甲", "助词", "乙"], ["left", " ", "right"], [0, 2])
        self.assertEqual(variants[2], [(0, 0), (2, 2)])
        self.assertEqual(strong.calls, 1)
        weak = FakeAligner([[0.95, 0.9], [0.9, 0.3]])
        variants = bridge.align_variants(weak, ["甲", "助词", "乙"], ["left", " ", "right"], [0, 2])
        self.assertEqual(variants[2], [(0, 0)])
        self.assertTrue(all(to != 1 for variant in variants for _, to in variant))
        connective = FakeAligner([[0.95, 0.9], [0.9, 0.86]])
        variants = bridge.align_variants(connective, ["甲", "助词", "乙"], ["但", "内心"], [0, 2])
        self.assertEqual(variants[2], [(0, 0)])

    def test_empty_or_truncated_input_does_not_infer(self):
        """空白输入与超过模型长度的词元均不得产生伪完整候选"""
        aligner = FakeAligner([[1, 0], [0, 1]])
        self.assertEqual(bridge.align_variants(aligner, [" "], ["word"]), [[], []])
        self.assertEqual(bridge.align_variants(aligner, ["词"] * 511, ["word"], [0]), [[], [], []])
        self.assertEqual(aligner.calls, 0)

    def test_expansion_requires_two_semantic_heads(self):
        """助词不能独自充当第二锚点，扩展范围只能来自所属原短语"""
        phrases = [
            {"indices": [0, 1], "heads": [0]},
            {"indices": [2, 3], "heads": [2]},
        ]
        self.assertEqual(bridge.expand_phrase_pairs([(0, 0), (3, 1)], phrases), [])
        self.assertEqual(bridge.expand_phrase_pairs([(0, 0), (2, 1)], phrases), [(0, 0), (1, 0), (2, 1), (3, 1)])


if __name__ == "__main__":
    unittest.main()
