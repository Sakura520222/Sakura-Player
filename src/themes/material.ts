import type { InjectionKey, Ref } from "vue";
import type { MaterialTier, RenderQuality } from "@/types/theme";

interface RenderCapabilities {
  backdrop: boolean;
  displacement: boolean;
  accelerated: boolean;
  highContrast: boolean;
  limitedDevice: boolean;
}

export interface MaterialContext {
  tier: MaterialTier;
  high: boolean;
  refraction: number;
}

export const materialKey: InjectionKey<Readonly<Ref<MaterialContext & { visible: boolean }>>> =
  Symbol("theme-material");

/**
 * 在系统可读性偏好、性能档位与 Chromium 能力之间选择材质
 * @param quality - 用户指定的渲染质量
 * @param refraction - 用户指定的折射强度
 * @param caps - 当前渲染环境的能力
 */
export function resolveMaterial(
  quality: RenderQuality,
  refraction: number,
  caps: RenderCapabilities,
): MaterialContext {
  if (quality === "low" || caps.highContrast || !caps.backdrop) {
    return { tier: "opaque", high: false, refraction };
  }
  if (!refraction || !caps.displacement || !caps.accelerated) {
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
 * 烘焙圆角平凸透镜的法线位移图，平面区域留在中性值
 * @param width - 玻璃实际宽度
 * @param height - 玻璃实际高度
 * @param radius - 圆角半径
 * @param high - 是否使用高质量采样
 * @returns 位移图的数据 URL
 */
export function bakeLensMap(width: number, height: number, radius: number, high: boolean): string {
  const canvas = document.createElement("canvas");
  const scale = Math.min(high ? 0.75 : 0.45, (high ? 640 : 320) / Math.max(width, height));
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d")!;
  const map = ctx.createImageData(canvas.width, canvas.height);
  const r = Math.min(radius, width / 2, height / 2);
  const bevel = Math.min(20, Math.min(width, height) / 3);
  const pixelX = width / canvas.width;
  const pixelY = height / canvas.height;
  for (let y = 0; y < canvas.height; y++) {
    const dy = (y + 0.5) * pixelY - height / 2;
    const qy = Math.abs(dy) - height / 2 + r;
    for (let x = 0; x < canvas.width; x++) {
      const dx = (x + 0.5) * pixelX - width / 2;
      const qx = Math.abs(dx) - width / 2 + r;
      const cx = Math.max(qx, 0);
      const cy = Math.max(qy, 0);
      const corner = Math.hypot(cx, cy);
      const distance = corner + Math.min(Math.max(qx, qy), 0) - r;
      const u = Math.max(0, Math.min(1, 1 + distance / bevel));
      const bevelSlope = u * u * (3 - 2 * u);
      // 在抗锯齿轮廓内收尾，避免采样和反光在圆角裁切边界叠成亮线
      const edgeFade = Math.max(0, Math.min(1, -distance / 4));
      const innerRim = edgeFade * edgeFade * (3 - 2 * edgeFade);
      const bend = 127 * bevelSlope * innerRim;
      const nx = Math.sign(dx) * (corner ? cx / corner : Number(qx >= qy));
      const ny = Math.sign(dy) * (corner ? cy / corner : Number(qy > qx));
      const i = (y * canvas.width + x) * 4;
      map.data[i] = 128 - nx * bend;
      map.data[i + 1] = 128 - ny * bend;
      if (high) {
        // 蓝色通道保存视线掠过边缘时的 Fresnel 反射和左上方光源的镜面高光
        const cosTheta = Math.sqrt(1 - (0.99 * bevelSlope) ** 2);
        const fresnel = (1 - cosTheta) ** 5;
        const specular = Math.max(0, -0.4 * nx - 0.91 * ny) ** 8 * bevelSlope ** 3;
        map.data[i + 2] = 255 * (fresnel * 0.24 + specular * 0.13) * innerRim;
      }
      map.data[i + 3] = 255;
    }
  }
  ctx.putImageData(map, 0, 0);
  const url = canvas.toDataURL();
  canvas.width = 0;
  canvas.height = 0;
  return url;
}
