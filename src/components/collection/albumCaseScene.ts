import meshUrl from "@/assets/album-case/case.bin?url";
import discUrl from "@/assets/album-case/disc.png";
import fallbackCover from "@/assets/images/song.jpg";
import {
  multiplyMatrix,
  partMatrix,
  poseMatrix,
  rotationY,
  translation,
  type Quaternion,
} from "./albumCaseMath";

interface Mesh {
  name: string;
  material: string;
  vertices: Float32Array;
  count: number;
}

interface Bounds {
  center: [number, number, number];
  radius: number;
  halfHeight: number;
}

export interface CaseNotes {
  title: string;
  heading: string;
  countLabel: string;
  count: string;
  dateLabel: string;
  date: string;
}

export interface AlbumCaseScene {
  draw: (pose: Quaternion, progress: number, cameraProgress: number) => void;
  setCover: (url: string | undefined, fallback: string | undefined) => Promise<void>;
  setNotes: (notes: CaseNotes) => void;
  dispose: () => void;
}

const VERTEX_SOURCE = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 uMvp;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  gl_Position = uMvp * vec4(aPosition, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vUv = vec2(aUv.x, 1.0 - aUv.y);
}`;

const FRAGMENT_SOURCE = `
precision highp float;
uniform sampler2D uCover;
uniform sampler2D uNotes;
uniform sampler2D uDisc;
uniform int uMaterial;
uniform bool uPaper;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 lightDirection = normalize(vec3(-0.48, 0.5, 0.72));
  float light = 0.85 + 0.35 * max(dot(normal, lightDirection), 0.0);
  float grazing = pow(1.0 - abs(normal.z), 3.0);
  float highlight = pow(max(dot(reflect(-lightDirection, normal), vec3(0.0, 0.0, 1.0)), 0.0), 48.0);
  vec4 color = vec4(vec3(0.04955), 1.0);
  if (uMaterial == 1) {
    if ((uPaper && !gl_FrontFacing) || (!uPaper && gl_FrontFacing)) discard;
    color = gl_FrontFacing ? texture2D(uNotes, vUv) : texture2D(uCover, vUv);
    if (gl_FrontFacing) light = 1.0;
  } else if (uMaterial == 2) {
    if (distance(vUv, vec2(0.5)) < 0.20) discard;
    color = texture2D(uCover, vUv);
  } else if (uMaterial == 3) {
    color = texture2D(uDisc, vUv);
  } else if (uMaterial == 4) {
    color = vec4(0.8795, 0.971, 1.0, 0.636);
  } else if (uMaterial == 5) {
    color = vec4(vec3(0.61518), 1.0);
  }
  float reflection = uMaterial == 4 ? 0.10 * grazing + 0.28 * highlight
    : uMaterial == 3 ? 0.10 * grazing + 0.18 * highlight : 0.0;
  gl_FragColor = vec4((color.rgb * light + reflection) * color.a, color.a);
}`;

/**
 * 读取交错存储的位置、法线与纹理坐标
 * @param data - 小端序专辑盒网格
 * @returns 网格部件列表
 */
export const parseCaseMesh = (data: ArrayBuffer): Mesh[] => {
  const view = new DataView(data);
  const decoder = new TextDecoder();
  let offset = 4;
  const meshes: Mesh[] = [];
  for (let i = 0; i < view.getInt32(0, true); i++) {
    const names: string[] = [];
    for (let j = 0; j < 2; j++) {
      const length = view.getInt32(offset, true);
      offset += 4;
      names.push(decoder.decode(new Uint8Array(data, offset, length)));
      offset += length;
    }
    const count = view.getInt32(offset, true);
    offset += 4;
    const vertices = new Float32Array(count * 8);
    for (let j = 0; j < vertices.length; j++) vertices[j] = view.getFloat32(offset + j * 4, true);
    offset += vertices.byteLength;
    meshes.push({ name: names[0], material: names[1], count, vertices });
  }
  return meshes;
};

/**
 * 计算开合姿态的包围体，保持相机与网格使用同一铰链
 * @param meshes - 模型网格
 * @param progress - 开合进度
 * @returns 居中偏移、水平旋转半径和半高
 */
const measureBounds = (meshes: Mesh[], progress: number): Bounds => {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    const matrix = partMatrix(mesh.name, progress);
    for (let i = 0; i < mesh.vertices.length; i += 8)
      for (let axis = 0; axis < 3; axis++) {
        const value =
          matrix[axis] * mesh.vertices[i] +
          matrix[axis + 4] * mesh.vertices[i + 1] +
          matrix[axis + 8] * mesh.vertices[i + 2] +
          matrix[axis + 12];
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
  }
  return {
    center: min.map((v, i) => -(v + max[i]) / 2) as Bounds["center"],
    radius: Math.hypot((max[0] - min[0]) / 2, (max[2] - min[2]) / 2),
    halfHeight: (max[1] - min[1]) / 2,
  };
};

/**
 * 解码可上传的图片，远端图片复用主进程代理以避免跨域污染纹理
 * @param url - 封面或内置资源地址
 * @returns 使用后需要关闭的位图
 */
const loadBitmap = async (url: string): Promise<ImageBitmap> => {
  let blob: Blob;
  if (/^https?:/i.test(url) && new URL(url).origin !== location.origin) {
    const response = await window.api.system.fetchRemoteBytes(url);
    if (!response.success || !response.data) throw new Error("封面读取失败");
    blob = new Blob([new Uint8Array(response.data)]);
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error("封面读取失败");
    blob = await response.blob();
  }
  return createImageBitmap(blob);
};

/**
 * 创建带深度缓冲与多重采样的专辑盒，资源仅属于当前弹窗
 * @param canvas - 输出画布
 * @param invalidate - 贴图更新后请求绘制
 * @returns 场景控制器，关闭弹窗时必须释放
 */
export const createAlbumCaseScene = async (
  canvas: HTMLCanvasElement,
  invalidate: () => void,
): Promise<AlbumCaseScene> => {
  const data = await fetch(meshUrl).then((response) => response.arrayBuffer());
  const meshes = parseCaseMesh(data);
  const closed = measureBounds(meshes, 0),
    opened = measureBounds(meshes, 1);
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    depth: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("无法创建专辑盒渲染器");
  const program = gl.createProgram()!;
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX_SOURCE],
    [gl.FRAGMENT_SHADER, FRAGMENT_SOURCE],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      throw new Error(error || "专辑盒着色器编译失败");
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw new Error(error || "专辑盒着色器链接失败");
  }
  gl.useProgram(program);
  const uniforms = Object.fromEntries(
    ["uMvp", "uModel", "uMaterial", "uPaper"].map((name) => [
      name,
      gl.getUniformLocation(program, name),
    ]),
  );
  const attributes = ["aPosition", "aNormal", "aUv"].map((name) =>
    gl.getAttribLocation(program, name),
  );
  attributes.forEach((location) => gl.enableVertexAttribArray(location));
  const buffers = meshes.map((mesh) => {
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    return { buffer, name: mesh.name, material: mesh.material, count: mesh.count };
  });
  const textures = [0, 1, 2].map((index) => {
    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([85, 82, 84, 255]),
    );
    gl.uniform1i(gl.getUniformLocation(program, ["uCover", "uNotes", "uDisc"][index]), index);
    return texture;
  });
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  let disposed = false,
    coverGeneration = 0;
  canvas.dataset.samples = String(gl.getParameter(gl.SAMPLES));

  /**
   * 更新一个纹理槽位，不保留已上传的 CPU 图片
   * @param index - 纹理槽位
   * @param source - 解码完成的图片或画布
   */
  const upload = (index: number, source: TexImageSource): void => {
    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, textures[index]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    invalidate();
  };
  void loadBitmap(discUrl)
    .then((bitmap) => {
      if (!disposed) upload(2, bitmap);
      bitmap.close();
    })
    .catch((error) => console.warn("[album-case] 碟片纹理加载失败", error));

  return {
    /**
     * 按不透明、透明、纸面顺序绘制，纸面偏移避免共面闪烁
     * @param pose - 用户观察方向
     * @param progress - 盒盖进度
     * @param cameraProgress - 相机拉远进度
     */
    draw(pose, progress, cameraProgress) {
      if (disposed) return;
      const width = canvas.clientWidth,
        height = canvas.clientHeight;
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio, 2, 1600 / width, 1600 / height);
      const pixelWidth = Math.round(width * ratio),
        pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      const referenceHeight = Math.min(width / 393, height / 369) * 369;
      const fov = 2 * Math.atan((Math.tan((21 * Math.PI) / 180) * height) / referenceHeight),
        aspect = width / height;
      const distances = [closed, opened].map((bounds, index) => {
        const angle = index ? fov / 2 : (21 * Math.PI) / 180;
        const viewAspect = index ? aspect : 393 / 369;
        return (
          Math.max(
            bounds.radius / Math.sin(Math.atan(Math.tan(angle) * viewAspect)),
            bounds.halfHeight / Math.tan(angle) + bounds.radius,
          ) * 1.04
        );
      });
      const distance = distances[0] + (distances[1] - distances[0]) * cameraProgress;
      const tangent = 1 / Math.tan(fov / 2),
        near = 0.1,
        far = 100;
      const projection = new Float32Array([
        tangent / aspect,
        0,
        0,
        0,
        0,
        tangent,
        0,
        0,
        0,
        0,
        (far + near) / (near - far),
        -1,
        0,
        0,
        (2 * far * near) / (near - far),
        0,
      ]);
      const camera = multiplyMatrix(projection, translation(0, 0, -distance));
      const center = closed.center.map((value, i) => value + (opened.center[i] - value) * progress);
      const root = multiplyMatrix(
        multiplyMatrix(poseMatrix(pose), rotationY(-35)),
        translation(center[0], center[1], center[2]),
      );
      for (let pass = 0; pass < 3; pass++) {
        gl.depthMask(pass === 0);
        gl.uniform1i(uniforms.uPaper, pass === 2 ? 1 : 0);
        if (pass === 2) {
          gl.enable(gl.POLYGON_OFFSET_FILL);
          gl.polygonOffset(-1, -1);
        } else gl.disable(gl.POLYGON_OFFSET_FILL);
        for (const mesh of buffers) {
          if (
            mesh.material === "Material.008" ||
            (pass === 0 && mesh.material === "Translucent") ||
            (pass === 1 && mesh.material !== "Translucent") ||
            (pass === 2 && mesh.material !== "Cover")
          )
            continue;
          const model = multiplyMatrix(root, partMatrix(mesh.name, progress));
          gl.uniformMatrix4fv(uniforms.uModel, false, model);
          gl.uniformMatrix4fv(uniforms.uMvp, false, multiplyMatrix(camera, model));
          const material =
            mesh.material === "Cover"
              ? 1
              : mesh.material === "DiscLabel"
                ? 2
                : ["Material.001", "Material.002"].includes(mesh.material)
                  ? 3
                  : mesh.material === "Translucent"
                    ? 4
                    : mesh.material === "FileBase"
                      ? 5
                      : 0;
          gl.uniform1i(uniforms.uMaterial, material);
          gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
          attributes.forEach((location, index) =>
            gl.vertexAttribPointer(
              location,
              index === 2 ? 2 : 3,
              gl.FLOAT,
              false,
              32,
              index === 2 ? 24 : index * 12,
            ),
          );
          gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);
    },
    /**
     * 按需更新封面，丢弃关闭弹窗或切换专辑后的迟到结果
     * @param url - 大封面地址
     * @param fallback - 缩略图地址
     */
    async setCover(url, fallback) {
      const generation = ++coverGeneration;
      let bitmap: ImageBitmap;
      try {
        bitmap = await loadBitmap(url || fallback || fallbackCover);
      } catch {
        bitmap = await loadBitmap(fallback || fallbackCover);
      }
      if (disposed || generation !== coverGeneration) {
        bitmap.close();
        return;
      }
      const size = Math.min(1200, bitmap.width, bitmap.height);
      const surface = document.createElement("canvas");
      surface.width = surface.height = size;
      const context = surface.getContext("2d")!;
      context.imageSmoothingQuality = "high";
      const crop = Math.min(bitmap.width, bitmap.height);
      context.drawImage(
        bitmap,
        (bitmap.width - crop) / 2,
        (bitmap.height - crop) / 2,
        crop,
        crop,
        0,
        0,
        size,
        size,
      );
      upload(0, surface);
      bitmap.close();
      surface.width = surface.height = 1;
    },
    /**
     * 将当前专辑的真实听歌手记绘制到独立纸面纹理
     * @param notes - 已本地化的标题和统计文案
     */
    setNotes(notes) {
      if (disposed) return;
      const paper = document.createElement("canvas");
      paper.width = paper.height = 1024;
      const context = paper.getContext("2d")!;
      // 内页与正面封面共用 UV，背面印刷需预先镜像
      context.translate(paper.width, 0);
      context.scale(-1, 1);
      context.fillStyle = "#575455";
      context.fillRect(0, 0, 1024, 1024);
      context.fillStyle = "#f2f2ee";
      context.textBaseline = "top";
      context.font = "34px sans-serif";
      context.fillText(notes.heading, 86, 78);
      context.font = '72px Georgia, "Songti SC", SimSun, serif';
      let line = "",
        row = 0;
      for (const character of notes.title) {
        if (context.measureText(line + character).width > 852 && line) {
          context.fillText(line, 86, 150 + row * 85);
          line = "";
          row++;
          if (row === 2) break;
        }
        line += character;
      }
      if (row < 2) context.fillText(line, 86, 150 + row * 85);
      context.fillStyle = "#ffffff1a";
      context.fillRect(86, 430, 852, 2);
      context.fillStyle = "#f2f2ee";
      context.font = "34px sans-serif";
      context.fillText(notes.countLabel, 86, 484);
      context.font = "120px Georgia, serif";
      context.fillText(notes.count, 86, 533);
      context.font = "34px sans-serif";
      context.fillText(notes.dateLabel, 86, 752);
      context.font = '58px Georgia, "Songti SC", SimSun, serif';
      context.fillText(notes.date, 86, 805, 852);
      upload(1, paper);
      paper.width = paper.height = 1;
    },
    /** 释放纹理、顶点、程序与上下文，关闭后不保留 GPU 资源 */
    dispose() {
      if (disposed) return;
      disposed = true;
      coverGeneration++;
      buffers.forEach((mesh) => gl.deleteBuffer(mesh.buffer));
      textures.forEach((texture) => gl.deleteTexture(texture));
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.width = canvas.height = 1;
    },
  };
};
