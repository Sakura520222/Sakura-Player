/**
 * 读取稳定行号或字词下标，兼容模型将整数写成 JSON 字符串
 * @param value - 模型返回的下标
 * @param label - 错误中使用的字段名称
 * @returns 非负安全整数，不猜测缺失下标或调整索引基准
 */
export const readLyricIndex = (value: unknown, label: string): number => {
  const index = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)
    throw new Error(`${label}必须是非负整数`);
  return index;
};
