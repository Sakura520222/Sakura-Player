import type { AuxiliaryLyricSpan } from "@shared/types/lyrics";

export const AUXILIARY_NAMESPACE = "urn:sakura-player:lyrics";
export const TRANSLATION_LRC_KEY = "sakura-translation";

/**
 * 读取辅助片段对应的原词包含下标，缺失或无效属性交给时间匹配
 * @param element - 单个辅助时间片段
 * @returns 有效的原词范围或空对象
 */
export const readAuxiliaryRange = (element: Element): Pick<AuxiliaryLyricSpan, "from" | "to"> => {
  const from = Number(
    element.getAttributeNS(AUXILIARY_NAMESPACE, "from") ??
      element.getAttribute("sakura:from") ??
      NaN,
  );
  const to = Number(
    element.getAttributeNS(AUXILIARY_NAMESPACE, "to") ?? element.getAttribute("sakura:to") ?? NaN,
  );
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to >= from
    ? { from, to }
    : {};
};

/**
 * 保存已校验的辅助原词范围，供单个语义片段与跨词发音无损重载
 * @param element - 待保存的辅助片段
 * @param part - 时间、文本及可选原词范围
 */
export const writeAuxiliaryRange = (element: Element, part: AuxiliaryLyricSpan): void => {
  if (part.from === undefined || part.to === undefined) return;
  element.ownerDocument.documentElement.setAttributeNS(
    "http://www.w3.org/2000/xmlns/",
    "xmlns:sakura",
    AUXILIARY_NAMESPACE,
  );
  element.setAttributeNS(AUXILIARY_NAMESPACE, "sakura:from", String(part.from));
  element.setAttributeNS(AUXILIARY_NAMESPACE, "sakura:to", String(part.to));
};
