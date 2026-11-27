export { getBassPulse, getFftBinRange } from "@shared/utils/audioFeatures";

const AMLL_VOLUME_BASE = 1;
const AMLL_VOLUME_RANGE = 2.4;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * 将低频脉冲映射为 AMLL 背景渲染器需要的低频音量
 * @param pulse - 低频脉冲强度，范围 0..1
 * @returns AMLL 低频音量
 */
export const toAmllLowFreqVolume = (pulse: number): number =>
  AMLL_VOLUME_BASE + clamp01(pulse) * AMLL_VOLUME_RANGE;
