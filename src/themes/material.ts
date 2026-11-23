import type { InjectionKey, Ref } from "vue";
import type { MaterialTier, RenderQuality } from "@/types/theme";

export interface RenderCapabilities {
  backdrop: boolean;
  displacement: boolean;
  accelerated: boolean;
  highContrast: boolean;
  limitedDevice: boolean;
  /** 真实 SVG 位移滤镜渲染验证，未提供时视为已通过 */
  svgFilterVerified?: boolean;
}

export interface MaterialContext {
  tier: MaterialTier;
  high: boolean;
  refraction: number;
}

export interface LensMapPixels {
  width: number;
  height: number;
  bevel: number;
  maxScale: number;
  data: Uint8ClampedArray;
}

export interface LensMap {
  width: number;
  height: number;
  bevel: number;
  maxScale: number;
  url: string;
}

export const materialKey: InjectionKey<Readonly<Ref<MaterialContext & { visible: boolean }>>> =
  Symbol("theme-material");

const GLASS_IOR = 1.5;
const MAX_INCIDENCE_SIN = Math.sin((52 * Math.PI) / 180);
const MAX_DEFLECTION_TAN = Math.tan(
  Math.asin(MAX_INCIDENCE_SIN) - Math.asin(MAX_INCIDENCE_SIN / GLASS_IOR),
);
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 在系统可读性偏好、性能档位与 Chromium 能力之间选择材质
 * @param quality - 用户指定的渲染质量
 * @param refraction - 用户指定的折射强度
 * @param caps - 当前渲染环境的能力
 * @returns 解析后的材质层级与参数
 */
export function resolveMaterial(
  quality: RenderQuality,
  refraction: number,
  caps: RenderCapabilities,
): MaterialContext {
  if (quality === "low" || caps.highContrast || !caps.backdrop) {
    return { tier: "opaque", high: false, refraction };
  }
  if (!refraction || !caps.displacement || !caps.accelerated || caps.svgFilterVerified === false) {
    return { tier: "frosted", high: false, refraction };
  }
  return {
    tier: "refraction",
    high: quality === "high" || (quality === "auto" && !caps.limitedDevice),
    refraction,
  };
}

/**
 * 只接受可用的硬件渲染上下文，探测后立即释放
 * @returns 是否可用硬件合成
 */
export function probeAcceleration(): boolean {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
  if (!gl) return false;
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}

/**
 * 校验真实 SVG 位移与混合滤镜在当前渲染管线中的像素输出
 * @returns SVG 位移滤镜与 backdrop 组合是否真实生效
 */
export async function probeSvgRefraction(): Promise<boolean> {
  if (typeof document === "undefined" || !document.body) return false;

  const filterId = `sakura-optics-probe-${Math.random().toString(36).slice(2, 8)}`;
  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = 4;
  mapCanvas.height = 4;
  const mapCtx = mapCanvas.getContext("2d");
  if (!mapCtx) return false;
  // R=255 表示向右采样偏移，B=255 表示保留清晰折射通道
  mapCtx.fillStyle = "rgb(255 128 255)";
  mapCtx.fillRect(0, 0, 4, 4);
  const mapUrl = mapCanvas.toDataURL();
  mapCanvas.width = 0;
  mapCanvas.height = 0;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:fixed;left:-9999px;top:-9999px;pointer-events:none";

  const filter = document.createElementNS(SVG_NS, "filter");
  filter.setAttribute("id", filterId);
  filter.setAttribute("x", "0");
  filter.setAttribute("y", "0");
  filter.setAttribute("width", "16");
  filter.setAttribute("height", "4");
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");

  const feImage = document.createElementNS(SVG_NS, "feImage");
  feImage.setAttribute("href", mapUrl);
  feImage.setAttribute("width", "16");
  feImage.setAttribute("height", "4");
  feImage.setAttribute("preserveAspectRatio", "none");
  feImage.setAttribute("result", "map");

  const feDisplace = document.createElementNS(SVG_NS, "feDisplacementMap");
  feDisplace.setAttribute("in", "SourceGraphic");
  feDisplace.setAttribute("in2", "map");
  feDisplace.setAttribute("scale", "16");
  feDisplace.setAttribute("xChannelSelector", "R");
  feDisplace.setAttribute("yChannelSelector", "G");

  filter.append(feImage, feDisplace);
  svg.append(filter);

  const probeEl = document.createElement("div");
  probeEl.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:4px;height:4px;backdrop-filter:url(#${filterId}) saturate(1.2)`;

  document.body.append(svg, probeEl);

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = 16;
  sourceCanvas.height = 4;
  const sourceCtx = sourceCanvas.getContext("2d");
  if (!sourceCtx) {
    svg.remove();
    probeEl.remove();
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    return false;
  }
  sourceCtx.fillStyle = "#ffffff";
  sourceCtx.fillRect(0, 0, 8, 4);
  sourceCtx.fillStyle = "#000000";
  sourceCtx.fillRect(8, 0, 8, 4);

  const testCanvas = document.createElement("canvas");
  testCanvas.width = 16;
  testCanvas.height = 4;

  try {
    const computedBackdrop = getComputedStyle(probeEl).backdropFilter;
    if (!computedBackdrop || !computedBackdrop.includes("url(")) return false;

    const ctx = testCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || typeof ctx.filter !== "string") return false;

    // 最多等待两帧确保 data URL 的 feImage 完成异步解码
    for (let attempt = 0; attempt < 3; attempt++) {
      ctx.filter = "none";
      ctx.clearRect(0, 0, 16, 4);
      ctx.filter = `url(#${filterId})`;
      ctx.drawImage(sourceCanvas, 0, 0);
      const pixel = ctx.getImageData(2, 2, 1, 1).data;
      // R=255 且 scale=16 时 (2,2) 应向右采样约 +8px，落入右侧黑色区域
      if (pixel[0] < 40 && pixel[1] < 40 && pixel[2] < 40 && pixel[3] > 200) {
        return true;
      }
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
    return false;
  } catch {
    return false;
  } finally {
    svg.remove();
    probeEl.remove();
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
    testCanvas.width = 0;
    testCanvas.height = 0;
  }
}

/**
 * 计算玻璃斜边宽度与防折叠最大位移系数
 * @param width - 玻璃实际宽度
 * @param height - 玻璃实际高度
 * @returns 斜边宽度与允许的最大 feDisplacementMap scale
 */
export function computeLensGeometry(
  width: number,
  height: number,
): { bevel: number; maxScale: number } {
  const bevel = Math.min(22, Math.min(width, height) * 0.36);
  // 限制位移梯度斜率小于 1，保证边缘映射严格单调不发生倒像折叠
  return { bevel, maxScale: bevel * 1.06 };
}

/**
 * 生成基于 Snell 定律的圆角平凸透镜位移像素数据
 * @param width - 玻璃 CSS 宽度
 * @param height - 玻璃 CSS 高度
 * @param radius - 圆角半径
 * @param high - 是否使用高质量采样分辨率
 * @returns 位移图像素数据与几何参数
 */
export function createLensMapPixels(
  width: number,
  height: number,
  radius: number,
  high: boolean,
): LensMapPixels {
  const resolution = Math.min(high ? 0.9 : 0.55, (high ? 720 : 360) / Math.max(width, height));
  const mapWidth = Math.max(2, Math.ceil(width * resolution));
  const mapHeight = Math.max(2, Math.ceil(height * resolution));
  const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
  const r = Math.min(Math.max(radius, 0), width / 2, height / 2);
  const { bevel, maxScale } = computeLensGeometry(width, height);
  // 法线半径至少与斜边等宽，保证斜边区域内完全避开 45 度内角法线折痕
  const normalRadius = Math.min(Math.max(r, bevel), width / 2, height / 2);
  const pixelX = width / mapWidth;
  const pixelY = height / mapHeight;

  for (let y = 0; y < mapHeight; y++) {
    const dy = (y + 0.5) * pixelY - height / 2;
    const qy = Math.abs(dy) - height / 2 + r;
    const nqy = Math.max(Math.abs(dy) - height / 2 + normalRadius, 0);
    const signY = dy < 0 ? -1 : 1;

    for (let x = 0; x < mapWidth; x++) {
      const dx = (x + 0.5) * pixelX - width / 2;
      const qx = Math.abs(dx) - width / 2 + r;
      const signX = dx < 0 ? -1 : 1;

      const cx = Math.max(qx, 0);
      const cy = Math.max(qy, 0);
      const corner = Math.hypot(cx, cy);
      const sd = corner + Math.min(Math.max(qx, qy), 0) - r;
      const i = (y * mapWidth + x) * 4;

      // 远离斜边的平直中心保留严格中性值，避免文字与控件区域产生形变
      if (sd <= -bevel) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 0;
        data[i + 3] = 255;
        continue;
      }

      const nqx = Math.max(Math.abs(dx) - width / 2 + normalRadius, 0);
      const normalLen = Math.hypot(nqx, nqy);
      const nx = normalLen > 0 ? signX * (nqx / normalLen) : signX * Number(qx >= qy);
      const ny = normalLen > 0 ? signY * (nqy / normalLen) : signY * Number(qy > qx);

      const s = Math.max(0, Math.min(1, 1 + sd / bevel));
      const profile = s * s * (3 - 2 * s);
      const sinI = MAX_INCIDENCE_SIN * profile;
      const deflection =
        sinI > 0 ? Math.tan(Math.asin(sinI) - Math.asin(sinI / GLASS_IOR)) / MAX_DEFLECTION_TAN : 0;
      const bend = 127 * deflection;

      data[i] = Math.round(128 - nx * bend);
      data[i + 1] = Math.round(128 - ny * bend);
      // 蓝色通道存储边缘清晰度掩码，中心柔和磨砂，斜边清晰透出折射光带
      data[i + 2] = Math.round(255 * 0.9 * profile);
      data[i + 3] = 255;
    }
  }

  return { width: mapWidth, height: mapHeight, bevel, maxScale, data };
}

/**
 * 烘焙圆角平凸透镜的法线位移图，平面区域留在中性值
 * @param width - 玻璃实际宽度
 * @param height - 玻璃实际高度
 * @param radius - 圆角半径
 * @param high - 是否使用高质量采样
 * @returns 包含位移图数据 URL 与几何参数的镜片描述
 */
export function bakeLensMap(width: number, height: number, radius: number, high: boolean): LensMap {
  const pixels = createLensMapPixels(width, height, radius, high);
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  ctx.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  canvas.width = 0;
  canvas.height = 0;
  return { width, height, bevel: pixels.bevel, maxScale: pixels.maxScale, url };
}
