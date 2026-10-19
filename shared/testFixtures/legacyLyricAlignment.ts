import baseline from "../../native/lyric-alignment/tests/fixtures/compatibility.json";
import type { AlignmentTrackResult } from "../types/lyricAlignment";

export interface ReadingToken {
  text: string;
  reading: string;
  readings?: string[];
  from: number;
  to: number;
}

/**
 * 统一测试输入对象的字段顺序，基线匹配不依赖对象的构造顺序
 * @param value - 当前测试输入或已记录的旧版输入
 */
const key = (value: unknown): string =>
  JSON.stringify(value, (_name, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((name) => [name, item[name]]),
        )
      : item,
  );

/**
 * 向渲染层应用及保存测试提供旧版固定结果，计算实现由 Rust 兼容性测试验证
 * @param tokens - 原文读音输入
 * @param existing - 已有音译
 */
export const alignRomanization = (
  tokens: ReadingToken[],
  existing: string,
): AlignmentTrackResult | null => {
  const fixture = baseline.cases.find(
    (entry) =>
      entry.operation === "alignRomanization" && key(entry.args) === key([tokens, existing]),
  );
  if (!fixture) throw new Error("缺少原生音译回归基线");
  return structuredClone(fixture.result) as AlignmentTrackResult | null;
};

/**
 * 为现有时间轴、重对齐及保存测试复用 Rust 已核对的旧版语义结果
 * @param source - 原文语义词元及范围
 * @param target - 完整译文分词
 * @param pairs - 固定模型词对
 */
export const alignTranslation = (
  source: Pick<ReadingToken, "text" | "from" | "to">[],
  target: string[],
  pairs: number[][],
): AlignmentTrackResult | null => {
  const fixture = baseline.cases.find(
    (entry) =>
      entry.operation === "alignTranslation" && key(entry.args) === key([source, target, pairs]),
  );
  if (!fixture) throw new Error("缺少原生翻译回归基线");
  return structuredClone(fixture.result) as AlignmentTrackResult | null;
};
