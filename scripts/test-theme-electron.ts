import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

interface DebugReply {
  id: number;
  result?: unknown;
  error?: unknown;
}

interface DebugTarget {
  url: string;
  webSocketDebuggerUrl: string;
}

interface AudioState {
  state: string;
  position: number;
}

interface LensBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const electron = createRequire(import.meta.url)("electron") as string;

const build = resolve(process.env.SAKURA_THEME_BUILD ?? "out");
const screenshots = process.env.SAKURA_THEME_SCREENSHOTS;
const useAudio = process.argv.includes("--audio");
const noGpu = process.argv.includes("--disable-gpu");
const requireRefraction = process.argv.includes("--require-refraction");
const measureMemory = process.argv.includes("--memory");
const outputDevice = process.env.SAKURA_THEME_OUTPUT_DEVICE;
const profile = await mkdtemp(join(tmpdir(), "sakura-theme-"));
const userData = join(profile, "SakuraPlayerData");
const audioDirectory = join(profile, "audio-fixtures");
const audioFixture = join(audioDirectory, "Sakura Theme Fixture");
const mainEntry = join(build, "main", "index.js");
await readFile(mainEntry);
const config = join(userData, "app-data", "config", "settings.json");
await mkdir(dirname(config), { recursive: true });
await writeFile(
  config,
  JSON.stringify({
    system: { onboardingCompleted: true, agreedAgreementVersion: 99 },
    update: { autoCheck: false },
    ...(useAudio ? { library: { scanDirs: [audioDirectory] } } : {}),
  }),
);
const classicBackground = "cache://backgrounds/ae1700401234d3f0.png";
if (!useAudio) {
  const directory = join(userData, "app-data", "cache", "backgrounds");
  await mkdir(directory, { recursive: true });
  await copyFile(
    resolve("public/icons/favicon-256x256.png"),
    join(directory, "ae1700401234d3f0.png"),
  );
}

const args = [mainEntry, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"];
if (process.platform === "linux") args.push("--no-sandbox");
if (noGpu) args.push("--disable-gpu", "--disable-software-rasterizer");
if (useAudio) {
  await mkdir(audioDirectory);
  // 静音 PCM 仍走实际解码和音频输出链路
  const dataBytes = 44100 * 2 * 90;
  const wave = Buffer.alloc(44 + dataBytes);
  wave.write("RIFF");
  wave.writeUInt32LE(36 + dataBytes, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(44100, 24);
  wave.writeUInt32LE(88200, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(dataBytes, 40);
  await writeFile(`${audioFixture}.wav`, wave);
  // 行首和行宽都不同，滚动时取样区内的字形也随之变化
  const verseTexts = [
    "低音弦轻轻振动",
    "The light is moving across the glass",
    "回声",
    "A longer phrase follows the quiet opening",
  ];
  const verses = Array.from({ length: 24 }, (_, index) => {
    const start = 14 + index * 3;
    return `<p begin="${start}s" end="${start + 2}s">${verseTexts[index % verseTexts.length]} ${index + 1}</p>`;
  });
  await writeFile(
    `${audioFixture}.ttml`,
    `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
      <p begin="1s" end="5s"><span begin="1s" end="2s">Sakura </span><span begin="2s" end="5s">Liquid</span></p>
      <p begin="9s" end="14s"><span begin="9s" end="14s">Theme playback fixture</span></p>
      ${verses.join("\n")}
    </div></body></tt>`,
  );
  const nextWave = Buffer.from(wave.subarray(0, 44 + 44100 * 2));
  nextWave.writeUInt32LE(nextWave.length - 8, 4);
  nextWave.writeUInt32LE(nextWave.length - 44, 40);
  await writeFile(join(audioDirectory, "Sakura Theme Next.wav"), nextWave);
  await Promise.all(
    Array.from({ length: 18 }, (_, index) =>
      writeFile(join(audioDirectory, `List refraction fixture ${index + 1}.wav`), nextWave),
    ),
  );
  await copyFile(resolve("public/icons/favicon-256x256.png"), join(audioDirectory, "cover.png"));
  if (!outputDevice) args.push(`${audioFixture}.wav`);
}

const child = spawn(electron, args, {
  env: { ...process.env, PORTABLE_EXECUTABLE_DIR: profile },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const exited = new Promise((done) => child.once("exit", done));
let browserLog = "";
let debugPort: string | undefined;
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    browserLog = (browserLog + chunk).slice(-12_000);
    debugPort ??= browserLog.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
  });
}

let socket: WebSocket | undefined;
const pending = new Map<number, (reply: DebugReply) => void>();
let sequence = 0;
const root = "document.documentElement";
const stores = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s";
const theme = `${stores}.get('theme')`;
const media = `${stores}.get('media')`;
const status = `${stores}.get('status')`;
const engineState = "(async () => (await window.api.player.getStatus()).data)()";
const settingsButton = 'header button[aria-label="全局设置"]';
const picker = '.theme-picker [role="radio"]';
const dialog = "[data-theme-settings]";
const nextTrack = "Sakura Theme Next";

/** 等待应用或渲染状态，并保留最后一次错误 */
async function until<T>(
  check: () => T | Promise<T>,
  label: string,
  timeout = 25_000,
): Promise<NonNullable<T>> {
  let cause;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline && child.exitCode === null && child.signalCode === null) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      cause = error;
    }
    await delay(120);
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(
      `Electron exited (${child.exitCode ?? child.signalCode}) while waiting for ${label}`,
      {
        cause,
      },
    );
  }
  throw new Error(`Timed out waiting for ${label}`, { cause });
}

/** 向当前 Electron 页面发送调试协议请求 */
async function send<T = void>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const connection = socket;
  assert.ok(connection);
  const id = ++sequence;
  const reply = await Promise.race([
    new Promise<DebugReply>((done) => {
      pending.set(id, done);
      connection.send(JSON.stringify({ id, method, params }));
    }),
    delay(10_000, null, { ref: false }),
  ]);
  pending.delete(id);
  if (!reply || reply.error)
    throw new Error(`${method}: ${JSON.stringify(reply?.error ?? "timeout")}`);
  return reply.result as T;
}

/** 在渲染进程执行断言或读取状态 */
async function evaluate<T = boolean>(expression: string): Promise<T> {
  const reply = await send<{
    result: { value: T };
    exceptionDetails?: { exception?: { description?: string }; text: string };
  }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (reply.exceptionDetails)
    throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
  return reply.result.value;
}

/**
 * 确认弹层进场结束且点击位置未被遮挡后，再派发真实指针事件
 * @param selector - 要点击的控件选择器
 */
async function click(selector: string): Promise<void> {
  const point = await until(
    () =>
      evaluate<{ x: number; y: number } | null>(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const popup = element.closest('[data-theme-popup], [data-dialog-content]');
    if (popup?.getAnimations().some(animation => animation.playState === 'running')) return null;
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    return rect.width && rect.height && element.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  })()`),
    selector,
  );
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point,
    button: "left",
    clickCount: 1,
  });
}

/** 捕捉窗口画面并按需保存本地验收图 */
async function capture(
  name: string,
  clip?: { x: number; y: number; width: number; height: number; scale: number },
): Promise<string> {
  const { data } = await send<{ data: string }>("Page.captureScreenshot", { format: "png", clip });
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await writeFile(join(screenshots, `${name}.png`), Buffer.from(data, "base64"));
  }
  return data;
}

/** 通过导航菜单打开外观设置 */
async function openAppearance(): Promise<void> {
  await click(settingsButton);
  await until(
    () => evaluate(`document.querySelector('[role="menu"]')?.dataset.state === 'open'`),
    "navigation menu",
  );
  await click('[role="menu"] [role="menuitem"]:last-child');
  await until(() => evaluate(`!!document.querySelector('${dialog}')`), "settings");
  await evaluate(`document.querySelector('${dialog} [data-menu-key="appearance"]').click()`);
  await until(
    () => evaluate(`document.querySelectorAll('${picker}').length === 2`),
    "theme preview cards",
  );
}

/** 校验改变位移滤镜时镜片边缘的真实像素变化 */
async function verifyRefraction(): Promise<void> {
  const lens = ".liquid-command-bar .liquid-lens";
  const box = await until(
    () =>
      evaluate<LensBox | undefined>(`document.querySelector('${lens}')?.dataset.liquidLens &&
    document.querySelector('${lens}').getBoundingClientRect().toJSON()`),
    "hardware lens",
  );
  await evaluate(`{
    const target = document.createElement('div');
    target.id = 'optics-fixture';
    target.style = 'position:fixed; left:${box.left}px; top:${box.top}px; width:${box.width}px; height:${box.height}px; z-index:10; background:#20202a';
    document.querySelector('.liquid-command-bar').before(target);
  }`);
  const clip = {
    x: Math.floor(box.left + box.width * 0.55),
    y: box.top + 2,
    width: 24,
    height: 17,
    scale: 1,
  };
  await delay(120);
  const uniform = await capture("edge-uniform", { ...clip, y: box.top, height: 20 });
  await evaluate(`document.querySelector('#optics-fixture').style.background =
    'repeating-linear-gradient(0deg, #eef 0 5px, #14141f 5px 10px)'`);
  await delay(120);
  const bent = await capture("refraction-on", clip);
  const centerClip = {
    x: clip.x,
    y: Math.floor(box.top + box.height * 0.45),
    width: 24,
    height: 12,
    scale: 1,
  };
  const centerFrosted = await capture("refraction-center", centerClip);
  await evaluate(
    `for (const node of document.querySelectorAll('${lens} feDisplacementMap')) node.setAttribute('scale', '0')`,
  );
  await delay(120);
  const flat = await capture("refraction-off", clip);
  const { difference, edgePeak, edgeChromaShift, centerContrast } = await evaluate<{
    difference: number;
    edgePeak: number;
    edgeChromaShift: number;
    centerContrast: number;
  }>(`(async () => {
    async function pixels(data) {
      const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    const [a, b, edge, center] = await Promise.all([
      ${JSON.stringify(bent)},
      ${JSON.stringify(flat)},
      ${JSON.stringify(uniform)},
      ${JSON.stringify(centerFrosted)},
    ].map(pixels));
    const rowRgb = (img) => Array.from({ length: img.height }, (_, y) => {
      let r = 0, g = 0, bl = 0;
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        r += img.data[i];
        g += img.data[i + 1];
        bl += img.data[i + 2];
      }
      return [r / img.width, g / img.width, bl / img.width];
    });
    const lum = ([r, g, bl]) => .2126 * r + .7152 * g + .0722 * bl;
    const edgeRgb = rowRgb(edge);
    const rows = edgeRgb.map(lum);
    const base = edgeRgb.at(-1);
    const topHalf = edgeRgb.slice(0, Math.ceil(edgeRgb.length / 2));
    // 校验边缘高光保持中性，不偏向固定紫色等偏色
    const edgeChromaShift = Math.max(...topHalf.map(([r, g, bl]) => {
      const dr = r - base[0], dg = g - base[1], db = bl - base[2];
      return Math.max(Math.abs(dr - dg), Math.abs(db - dg), Math.abs(dr - db));
    }));
    const centerRows = rowRgb(center).map(lum);
    return {
      difference: a.data.reduce((sum, value, index) => sum + Math.abs(value - b.data[index]), 0) / a.data.length,
      edgePeak: Math.max(...rows.slice(0, Math.ceil(rows.length / 2))) - rows.at(-1),
      edgeChromaShift,
      centerContrast: Math.max(...centerRows) - Math.min(...centerRows),
    };
  })()`);
  assert.ok(difference > 3, `Background pixel difference was ${difference}`);
  assert.ok(edgePeak < 18, `Uniform backdrop had a bright edge of ${edgePeak.toFixed(2)} levels`);
  assert.ok(
    edgeChromaShift < 10,
    `Uniform backdrop edge had color cast of ${edgeChromaShift.toFixed(2)} levels`,
  );
  assert.ok(
    centerContrast < 16,
    `Refracting glass center must remain frosted (contrast was ${centerContrast.toFixed(2)})`,
  );
  console.log(`Refractive edge mean pixel delta: ${difference.toFixed(2)}`);
  console.log(
    `Uniform backdrop edge overshoot: ${edgePeak.toFixed(2)}, chroma shift: ${edgeChromaShift.toFixed(2)}`,
  );
  console.log(`Refracting glass center stripe contrast: ${centerContrast.toFixed(2)}`);
  await evaluate("document.querySelector('#optics-fixture').remove()");
}

/**
 * 从真实滚动内容取样，确认 Dock 内同时存在背景移动和折射
 * @param name - 验收截图名称
 * @param dock - Dock 选择器
 * @param viewport - 返回实际滚动视口的表达式
 * @param scroll - 移动滚动内容
 */
async function verifyDockBackdrop(
  name: string,
  dock: string,
  viewport: string,
  scroll: (step: number) => Promise<void>,
): Promise<void> {
  const lens = `${dock} [data-liquid-lens]`;
  const clip = await until(
    () =>
      evaluate<{
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
      } | null>(`(() => {
      const glass = document.querySelector('${lens}')?.getBoundingClientRect();
      const content = (${viewport})?.getBoundingClientRect();
      if (!glass || !content || content.bottom < glass.bottom - 1) return null;
      const x = Math.ceil(Math.max(glass.left + 30, content.left + 38));
      const end = Math.min(content.right, glass.right - 32, x + 248);
      return { x, y: Math.ceil(glass.top + 3), width: Math.floor(end - x), height: 26, scale: 1 };
    })()`),
    `${name} scroll viewport behind the glass`,
  );
  const pixels = async (a: string, b: string): Promise<number> =>
    evaluate<number>(`(async () => {
      async function read(data) {
        const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      }
      const [a, b] = await Promise.all([${JSON.stringify(a)}, ${JSON.stringify(b)}].map(read));
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 26) ++changed;
      }
      return changed;
    })()`);
  let first: string | undefined;
  let refracted = 0;
  let moved = 0;
  for (let step = 0; step < 7; step++) {
    await scroll(step);
    await delay(420);
    const bent = await capture(`${name}-bent`, clip);
    if (first) moved = Math.max(moved, await pixels(first, bent));
    else first = bent;
    const scales = await evaluate<
      Array<string | null>
    >(`[...document.querySelectorAll('${lens} feDisplacementMap')].map(node => {
      const scale = node.getAttribute('scale');
      node.setAttribute('scale', '0');
      return scale;
    })`);
    await delay(80);
    const flat = await capture(`${name}-flat`, clip);
    await evaluate(`[...document.querySelectorAll('${lens} feDisplacementMap')].forEach((node, i) =>
      node.setAttribute('scale', ${JSON.stringify(scales)}[i]))`);
    refracted = Math.max(refracted, await pixels(bent, flat));
    if (moved > 24 && refracted > 24) break;
  }
  console.log(
    `${name}: ${moved} pixels changed while scrolling, ${refracted} changed from displacement`,
  );
  assert.ok(moved > 24 && refracted > 24, `${name} must refract the moving content behind it`);
}

try {
  const target = await until(async () => {
    if (!debugPort) return null;
    const list = (await (
      await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    ).json()) as DebugTarget[];
    return list.find((page) => page.url.includes("/renderer/index.html"));
  }, "main renderer");
  const connection = new WebSocket(target.webSocketDebuggerUrl);
  socket = connection;
  await new Promise<void>((done, reject) => {
    connection.onopen = () => done();
    connection.onerror = reject;
  });
  connection.onmessage = ({ data }) => {
    const reply = JSON.parse(data as string) as DebugReply;
    pending.get(reply.id)?.(reply);
  };
  const ready = (): Promise<boolean> =>
    evaluate(
      "!!document.querySelector('.player-shell') && !document.querySelector('#app-loading')",
    );
  await until(ready, "initial Classic shell");
  if (useAudio) {
    if (outputDevice) {
      const device = JSON.stringify(outputDevice);
      await evaluate(`(async () => {
        ${stores}.get('settings').player.outputDevice = ${device};
        await window.api.player.setOutputDevice(${device});
      })()`);
      const opener = spawn(electron, [mainEntry, `${audioFixture}.wav`], {
        env: { ...process.env, PORTABLE_EXECUTABLE_DIR: profile },
        stdio: "ignore",
        windowsHide: true,
      });
      await new Promise<void>((done, reject) => {
        opener.once("error", reject);
        opener.once("exit", () => done());
      });
    }
    await until(() => evaluate(`!!${media}.track && ${status}.duration > 0`), "real local audio");
    await evaluate(`${theme}.mode = 'dark'; ${theme}.setCustomColor('#638fc7')`);
  } else {
    await evaluate(
      `localStorage.setItem('theme', JSON.stringify({
        mode: 'light', source: 'custom', customColor: '#638fc7', appearanceStyle: 'image',
        imageBackground: { src: '${classicBackground}', blur: 12, dim: .65, scale: 1.3 },
      }))`,
    );
    await send("Page.reload");
    await until(
      () =>
        evaluate(
          `${theme}?.customColor === '#638fc7' && ${root}.dataset.theme === 'classic' && !document.querySelector('#app-loading')`,
        ),
      "migrated Classic",
    );
    await until(
      () =>
        evaluate(`${root}.classList.contains('dark') &&
      document.querySelector('img[src="${classicBackground}"]')?.naturalWidth > 0`),
      "decoded legacy background",
    );
  }
  const classic = await evaluate<{ y: number; height: number }>(
    "document.querySelector('header').getBoundingClientRect().toJSON()",
  );
  assert.equal(classic.y, 0);
  assert.equal(classic.height, 64);
  const appearance = `${stores}.get('settings').appearance`;
  await evaluate(`${appearance}.layoutMode = 'floating'`);
  await until(
    () => evaluate("document.querySelector('aside').getBoundingClientRect().x === 12"),
    "Classic floating sidebar",
  );
  await evaluate(`${appearance}.layoutMode = 'default'`);
  await capture("classic");

  await evaluate("window.beforeTheme = document.querySelector('main')");
  let identity = await evaluate<string | null>(`${status}.currentTrack?.id ?? null`);
  if (useAudio) {
    if (!(await evaluate(`${status}.isPlaying`))) await click("footer [data-theme-play-toggle]");
    await until(async () => {
      const native = await evaluate<AudioState>(engineState);
      return native?.state === "playing" && native.position > 0 && native;
    }, "advancing audio engine");
  }
  const position = useAudio ? (await evaluate<AudioState>(engineState)).position : 0;
  await openAppearance();
  await click(`${picker}:last-child`);
  await until(
    () =>
      evaluate(
        `${root}.dataset.theme === 'sakura-liquid' && !!document.querySelector('#setting-themeRenderQuality')`,
      ),
    "Liquid shell and settings",
  );
  assert.equal(await evaluate("window.beforeTheme === document.querySelector('main')"), true);
  assert.equal(await evaluate(`${status}.currentTrack?.id ?? null`), identity);
  if (useAudio)
    await until(async () => {
      const native = await evaluate<AudioState>(engineState);
      return native?.state === "playing" && native.position > position && native;
    }, "playback after theme switch");
  await capture("settings");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await until(() => evaluate(`!document.querySelector('${dialog}')`), "settings Escape");
  await openAppearance();
  await until(
    () =>
      evaluate(
        "document.querySelector('[data-dialog-content]').getAnimations().every(a => a.playState === 'finished')",
      ),
    "settings entrance",
  );
  const dialogGeometry = await evaluate(`(() => {
    const el = document.querySelector('[data-dialog-content]');
    return [el.offsetTop, el.offsetHeight];
  })()`);
  await click('[data-dialog-content] button[aria-label="关闭"]');
  const fadingGeometry = await evaluate(`(() => {
    const el = document.querySelector('[data-dialog-content][data-state="closed"]');
    return el && [el.offsetTop, el.offsetHeight];
  })()`);
  assert.deepEqual(fadingGeometry, dialogGeometry);
  await until(() => evaluate(`!document.querySelector('${dialog}')`), "settings close button");
  await openAppearance();
  await click('[data-dialog-content] button[aria-label="关闭"]');
  await until(() => evaluate(`!document.querySelector('${dialog}')`), "settings rapid reopen");

  await evaluate(`${theme}.mode = 'dark'; ${theme}.options.material.quality = 'high'`);
  const material = await evaluate<string>(`${root}.dataset.materialTier`);
  console.log(`Active material: ${material}`);
  if (material === "refraction") await verifyRefraction();
  else assert.equal(requireRefraction, false, "Expected hardware refraction on this runner");
  if (noGpu) assert.notEqual(material, "refraction");
  await capture("liquid");
  await evaluate(`Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'))`);
  await until(
    () =>
      evaluate(
        `${root}.dataset.themeVisibility === 'hidden' && !document.querySelector('[data-liquid-lens]')`,
      ),
    "background lenses released",
  );
  await evaluate(
    `delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))`,
  );
  if (process.platform === "win32" && useAudio) {
    await evaluate("window.api.window.minimize()");
    await until(
      () =>
        evaluate(
          `${root}.dataset.themeVisibility === 'hidden' && !document.querySelector('[data-liquid-lens]')`,
        ),
      "minimized Windows window releases lenses",
    );
    const opener = spawn(electron, [mainEntry], {
      env: { ...process.env, PORTABLE_EXECUTABLE_DIR: profile },
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await until(
        () => evaluate(`!document.hidden && ${root}.dataset.themeVisibility === 'visible'`),
        "restored Windows window",
      );
    } finally {
      if (opener.exitCode === null) opener.kill();
    }
    if (material === "refraction") {
      await until(
        () => evaluate("!!document.querySelector('.liquid-dock [data-liquid-lens]')"),
        "restored Windows dock lens",
      );
    }
  }

  await evaluate(`${theme}.options.material.quality = 'low'`);
  await until(
    () =>
      evaluate(
        `${root}.dataset.materialTier === 'opaque' && !document.querySelector('[data-liquid-lens]')`,
      ),
    "low power",
  );
  await evaluate(`${theme}.options.material.quality = 'high'`);
  await send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-contrast", value: "more" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  await until(
    () =>
      evaluate(
        `${root}.dataset.materialTier === 'opaque' && ${root}.hasAttribute('data-reduced-motion')`,
      ),
    "system accessibility preferences",
  );
  await send("Emulation.setEmulatedMedia", { features: [] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 900,
    height: 630,
    deviceScaleFactor: 1.25,
    mobile: false,
  });
  await until(
    () => evaluate("innerWidth === 900 && !!document.querySelector('.liquid-shell-narrow')"),
    "narrow window",
  );
  await delay(330);
  assert.equal(
    await evaluate("document.querySelector('.liquid-rail').getBoundingClientRect().width"),
    64,
  );
  await capture("narrow");
  await send("Emulation.clearDeviceMetricsOverride");

  if (useAudio) {
    await evaluate("location.hash = '/library'");
    const listViewport = "document.querySelector('[data-song-item]')?.closest('.overflow-y-auto')";
    await until(() => evaluate(`!!(${listViewport})?.clientHeight`), "scanned local song list");
    /**
     * 通过列表自己的滚动机制将扫描入库的曲目带入视口
     * @param title - 隔离曲库中的曲名
     * @returns 当前渲染行的表达式
     */
    const findRow = async (title: string): Promise<string> => {
      const row = `[...document.querySelectorAll('[data-song-item]')].find(el => el.textContent.includes(${JSON.stringify(title)}))`;
      await until(
        () =>
          evaluate(`(() => {
          const el = ${row};
          const view = ${listViewport};
          if (!el) {
            view.scrollTop = view.scrollTop + view.clientHeight >= view.scrollHeight - 2
              ? 0 : view.scrollTop + view.clientHeight * 0.7;
            return false;
          }
          const box = el.getBoundingClientRect();
          const clip = view.getBoundingClientRect();
          const dock = document.querySelector('.liquid-dock')?.getBoundingClientRect();
          if (box.top >= clip.top && box.bottom <= Math.min(clip.bottom, dock?.top ?? Infinity)) return true;
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          return false;
        })()`),
        title,
      );
      return row;
    };
    const currentRow = await findRow("Sakura Theme Fixture");
    const indexedId = await evaluate<string>(
      `${stores}.get('library').tracks.find(track => track.title.includes('Sakura Theme Fixture')).id`,
    );
    await evaluate(`(${currentRow}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
    await until(
      () =>
        evaluate(
          `${media}.track?.id === ${JSON.stringify(indexedId)} && ${status}.duration > 0 && ${status}.isPlaying`,
        ),
      "playing the indexed song in the list",
    );
    identity = indexedId;
    if (material === "refraction") {
      await evaluate(`${theme}.mode = 'light'`);
      await send("Emulation.setDeviceMetricsOverride", {
        width: 1500,
        height: 800,
        deviceScaleFactor: 1.25,
        mobile: false,
      });
      await verifyDockBackdrop("song-list-dock", ".liquid-dock", listViewport, async (step) => {
        await evaluate(`(${listViewport}).scrollTop = ${126 + step * 31}`);
      });
      await capture("song-list");
      await until(
        () =>
          evaluate(`(() => {
        const shortcuts = document.querySelector('[data-song-list-shortcuts]');
        const dock = document.querySelector('.liquid-dock').getBoundingClientRect();
        const group = shortcuts.getBoundingClientRect();
        return shortcuts.querySelectorAll('button').length === 2 &&
          group.left > dock.right && Math.abs(group.bottom - dock.bottom) <= 1;
      })()`),
        "wide song shortcuts beside the dock",
        4000,
      );
      await send("Emulation.clearDeviceMetricsOverride");
      await until(
        () =>
          evaluate(`(() => {
        const shortcuts = document.querySelector('[data-song-list-shortcuts]');
        const dock = document.querySelector('.liquid-dock').getBoundingClientRect();
        const group = shortcuts.getBoundingClientRect();
        return shortcuts.querySelectorAll('button').length === 2 &&
          getComputedStyle(shortcuts).flexDirection === 'row' && group.bottom < dock.top;
      })()`),
        "compact song shortcuts are above the dock",
      );
    }
    const nextRow = await findRow(nextTrack);
    await evaluate(`(${nextRow}).setAttribute('data-theme-fixture-row', '')`);
    await click("[data-theme-fixture-row] [data-theme-row-action]");
    await until(
      () =>
        evaluate(`(() => {
        const item = [...document.querySelectorAll('[data-theme-popup][data-state="open"] [role="menuitem"]')]
          .find(el => el.textContent.includes('下一首播放'));
        item?.setAttribute('data-theme-fixture-next', '');
        return !!item;
      })()`),
      "Liquid song action",
    );
    await click("[data-theme-fixture-next]");
    await until(
      () => evaluate("!document.querySelector('[data-theme-popup]')"),
      "song action popup closed",
    );
    assert.equal(await evaluate<string>(`${status}.currentTrack?.id`), identity);
    await evaluate(`${theme}.mode = 'dark'`);
    await evaluate(`${stores}.get('settings').player.autoImmersive = false`);
    await evaluate(`{
      window.sharedCoverSeen = false;
      window.coverObserver = new MutationObserver(() => {
        window.sharedCoverSeen ||= !!document.querySelector('[data-player-cover="full"][data-player-shared]');
      });
      window.coverObserver.observe(document.querySelector('body'), { attributes: true, attributeFilter: ['data-player-shared'], subtree: true });
    }`);
    await click("footer [data-player-expand]");
    await until(
      () =>
        evaluate(`!!document.querySelector('[data-liquid-player]') && ${status}.isPlayerExpanded`),
      "Liquid full player",
    );
    assert.equal(
      await evaluate<string>(
        "getComputedStyle(document.querySelector('[data-liquid-player]')).backgroundImage",
      ),
      "none",
      "Liquid must preserve the album background brightness",
    );
    await until(
      () =>
        evaluate(
          `${media}.activeLyric?.format === 'ttml' && ${media}.parsedLyric.some(line => line.words?.length >= 2) &&
          document.querySelector('[data-player-layout="lyric"]')?.textContent.match(/Sakura\\s*Liquid/)`,
        ),
      "rendered word-timed TTML",
    );
    assert.ok(
      await evaluate(
        "document.querySelector('.liquid-playing-dock')?.getBoundingClientRect().bottom < innerHeight - 8",
      ),
    );
    assert.equal(
      await evaluate("window.sharedCoverSeen"),
      true,
      "Full cover participated in the shared transition",
    );
    await evaluate("window.coverObserver.disconnect()");
    const playerOptions = `${stores}.get('settings').player`;
    if (material === "refraction") {
      const background = await evaluate<string>(`${playerOptions}.playerBgType`);
      await evaluate(`${playerOptions}.playerBgType = 'solid'; window.api.player.pause()`);
      await until(
        async () => (await evaluate<AudioState>(engineState)).state === "paused",
        "paused lyric fixture",
      );
      const lyrics = 'document.querySelector(".liquid-playing-lyrics [data-player-layout=lyric]")';
      const box = await evaluate<LensBox>(`${lyrics}.getBoundingClientRect().toJSON()`);
      await verifyDockBackdrop("lyrics-dock", ".liquid-playing-dock", lyrics, async () => {
        await send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
          deltaX: 0,
          deltaY: 34,
        });
      });
      await evaluate(
        `${playerOptions}.playerBgType = ${JSON.stringify(background)}; window.api.player.play()`,
      );
    }
    await evaluate(`${stores}.get('settings').appearance.showQualitySwitch = true`);
    for (const width of [1600, 1280, 900, 720, 450]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 450 ? 300 : 800,
        deviceScaleFactor: 1.25,
        mobile: false,
      });
      await until(
        () =>
          evaluate(`innerWidth === ${width} && document.querySelector('.player-panel')
          .getAnimations().every(animation => animation.playState !== 'running')`),
        `full-player viewport ${width}`,
      );
      const dock = await evaluate<{
        width: number;
        centered: boolean;
        symmetric: boolean;
        expectedSizes: boolean;
        controlsFit: boolean;
      }>(`(() => {
        const element = document.querySelector('.liquid-playing-dock');
        const rect = element.getBoundingClientRect();
        const elements = [...element.querySelectorAll(':scope > [data-player-dock-actions], :scope > [data-player-dock-transport]')];
        const groups = elements.map(group => group.getBoundingClientRect());
        const [left, center, right] = groups;
        const playButton = elements[1].querySelectorAll('.s-button')[2];
        const play = playButton.getBoundingClientRect();
        const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        return {
          width: rect.width,
          centered: Math.abs(rect.left + rect.right - innerWidth) < 2,
          symmetric: Math.abs(left.width - right.width) < 1 &&
            Math.abs(center.left + center.right - innerWidth) < 2 &&
            Math.abs(play.left + play.right - innerWidth) < 2,
          expectedSizes: getComputedStyle(element).height === (innerWidth <= 800 ? '104px' : '80px') &&
            getComputedStyle(playButton).width === (innerWidth <= 800 ? '30px' : '40px'),
          controlsFit: groups.every((box, i) => box.left >= rect.left && box.right <= rect.right &&
            box.top >= rect.top && box.bottom <= rect.bottom && groups.slice(i + 1).every(other => !overlap(box, other)) &&
            [...elements[i].querySelectorAll('button')].filter(button => button.getClientRects().length > 0).every(button => {
              const bounds = button.getBoundingClientRect();
              return bounds.left >= box.left - 1 && bounds.right <= box.right + 1;
            })),
        };
      })()`);
      assert.ok(
        dock.width <= Math.min(width - 24, 1000) &&
          dock.centered &&
          dock.symmetric &&
          dock.expectedSizes &&
          dock.controlsFit,
        `Compact full-player dock at ${width}px: ${JSON.stringify(dock)}`,
      );
      await capture(`full-player-compact-${width}`);
      if (width === 450) {
        const readable = await evaluate<boolean>(`(async () => {
          const settings = ${stores}.get("settings").system.companion;
          const { enabled, danmaku, danmakuLanes } = settings;
          try {
            Object.assign(settings, { enabled: true, danmaku: true, danmakuLanes: 3 });
            await new Promise(requestAnimationFrame);
            const box = (selector) => document.querySelector(selector).getBoundingClientRect();
            const lanes = box('.companion-danmaku'), art = box('.liquid-album-art'), data = box('.liquid-album-data');
            const separated = art.bottom <= data.top + 1 || art.right <= data.left + 1;
            return data.height >= 16 && art.width > 0 && separated && data.top >= lanes.bottom - 1 &&
              data.bottom <= box('.liquid-playing-dock').top + 1;
          } finally {
            Object.assign(settings, { enabled, danmaku, danmakuLanes });
          }
        })()`);
        assert.ok(
          readable,
          "Three comment lanes must leave the cover and song information visible",
        );
      }
    }
    await send("Emulation.clearDeviceMetricsOverride");
    if (material === "refraction") {
      await until(
        () =>
          evaluate(`(() => {
            const lens = document.querySelector('.liquid-playing-dock .liquid-lens');
            const filter = lens?.querySelector('filter');
            return !!filter && Math.abs(Number(filter.getAttribute('width')) - lens.clientWidth) <= 1;
          })()`),
        "live filter region matches restored dock width",
      );
    }
    await capture("full-player");
    const tint = await evaluate<{ colorDifference: number; opacity: number }>(`(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      const lens = document.querySelector('.liquid-playing-dock .liquid-lens');
      const style = getComputedStyle(lens);
      ctx.fillStyle = style.backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const glass = ctx.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = 'rgb(' + style.getPropertyValue('--s-cover-base') + ')';
      ctx.fillRect(0, 0, 1, 1);
      const cover = ctx.getImageData(0, 0, 1, 1).data;
      return {
        colorDifference: Math.max(...[0, 1, 2].map(index => Math.abs(cover[index] - glass[index]))),
        opacity: glass[3] / 255,
      };
    })()`);
    assert.ok(tint.colorDifference <= 5 && tint.opacity <= 0.36, JSON.stringify(tint));

    const lyricArea = "document.querySelector('.liquid-playing-lyrics [data-player-layout=lyric]')";
    const geometry = `${lyricArea}.getBoundingClientRect().toJSON()`;
    const mask = `getComputedStyle(${lyricArea}).maskImage`;
    const normalBounds = await evaluate<LensBox>(geometry);
    const normalMask = await evaluate<string>(mask);
    await evaluate(`${playerOptions}.autoImmersive = true`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 24, y: 164 });
    await until(
      () =>
        evaluate(
          "getComputedStyle(document.querySelector('.liquid-playing-dock')).opacity === '0'",
        ),
      "immersive player with hidden controls",
    );
    assert.deepEqual(await evaluate<LensBox>(geometry), normalBounds);
    assert.equal(await evaluate<string>(mask), normalMask);
    const lyricInset = await evaluate<number>(
      `parseFloat(getComputedStyle(${lyricArea}).getPropertyValue('--liquid-lyric-bottom-inset'))`,
    );
    assert.equal(lyricInset, normalBounds.top);
    await capture("immersive-lyrics");
    await evaluate(`${playerOptions}.autoImmersive = false`);
    await until(
      () =>
        evaluate(
          "getComputedStyle(document.querySelector('.liquid-playing-dock')).opacity === '1'",
        ),
      "restore visible full-player controls",
    );
    assert.equal(await evaluate<string>(mask), normalMask);
    if (process.platform === "win32") {
      const badge = ".liquid-playing-dock [data-audio-output-mode-trigger]";
      const menu = "[data-theme-popup][role=menu][data-state=open]";
      await evaluate("window.api.player.pause()");
      await until(
        async () => (await evaluate<AudioState>(engineState)).state === "paused",
        "pause the song for the click-through check",
      );
      await delay(450);
      const paused = await evaluate<AudioState>(engineState);
      await evaluate(`${playerOptions}.autoImmersive = true`);
      await click(badge);
      const popup = await until(
        () =>
          evaluate<LensBox | undefined>(
            `document.querySelector('${menu}')?.getBoundingClientRect().toJSON()`,
          ),
        "opened full-player output menu",
      );
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: popup.left + popup.width / 2,
        y: popup.top + popup.height / 2,
      });
      await delay(3400);
      assert.equal(
        await evaluate<string>(
          "getComputedStyle(document.querySelector('.liquid-playing-dock')).opacity",
        ),
        "1",
      );
      assert.equal(
        await evaluate(`(() => {
        const button = document.querySelector('${badge}');
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })()`),
        true,
        "the modal menu's trigger still receives clicks",
      );
      await click(badge);
      await until(
        () => evaluate(`!document.querySelector('${menu}')`),
        "close popup by clicking the same badge",
      );
      assert.equal(
        await evaluate<string>(
          "getComputedStyle(document.querySelector('.liquid-playing-dock')).opacity",
        ),
        "1",
      );
      await click(badge);
      await until(
        () => evaluate(`!!document.querySelector('${menu}')`),
        "badge reopens the output menu",
      );
      const reopened = await evaluate<AudioState>(engineState);
      assert.equal(reopened.state, "paused");
      assert.ok(
        Math.abs(reopened.position - paused.position) < 100,
        `Badge clicks must preserve position: ${paused.position} → ${reopened.position}`,
      );
      const lyricPoint = await until(
        () =>
          evaluate<{ x: number; y: number } | null>(`(() => {
          const area = document.querySelector('[data-player-layout=lyric]');
          const line = [...area.querySelectorAll('.lp-line, [class*="lyricMainLine"]')]
            .map(el => el.getBoundingClientRect())
            .find(rect => rect.width > 0 && rect.top > innerHeight * 0.25 && rect.bottom < innerHeight * 0.7);
          return line ? { x: line.left + Math.min(30, line.width / 2), y: line.top + line.height / 2 } : null;
        })()`),
        "visible lyric behind the menu",
      );
      assert.equal(
        await evaluate("document.querySelector('[data-player-layout=lyric]').inert"),
        true,
      );
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        ...lyricPoint,
        button: "left",
        clickCount: 1,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        ...lyricPoint,
        button: "left",
        clickCount: 1,
      });
      await until(
        () =>
          evaluate(
            `!document.querySelector('${menu}') && !document.querySelector('[data-player-layout=lyric]').inert`,
          ),
        "outside click closes menu and restores lyric interaction",
      );
      await delay(150);
      const after = await evaluate<AudioState>(engineState);
      assert.equal(after.state, "paused");
      assert.ok(
        Math.abs(after.position - paused.position) < 100,
        `Dismissing the menu must preserve position: ${paused.position} → ${after.position}`,
      );
      await evaluate(`${playerOptions}.autoImmersive = false; window.api.player.play()`);
    }
    await evaluate(
      `${playerOptions}.playerBgType = 'animation'; ${playerOptions}.enableSpectrum = true`,
    );
    const backgroundSurface = noGpu
      ? ".bg-blur-wrap .bg-img.active"
      : ".bg-fluid-wrap.ready canvas";
    const visualizersReady = (): Promise<boolean> =>
      evaluate(`(() => {
        const background = document.querySelector('${backgroundSurface}');
        const painted = ${noGpu} ? background?.complete && background.naturalWidth > 0 : background?.width > 0;
        return painted && !!document.querySelector('.spectrum-canvas')?.width;
      })()`);
    await until(visualizersReady, "visible background and spectrum");
    const previewVisible =
      "getComputedStyle(document.querySelector('.bg-blur-wrap')).display !== 'none'";
    await until(
      () => evaluate(`(${previewVisible}) === ${noGpu}`),
      "background preview visibility",
    );
    await evaluate(`window.backgroundSurface = document.querySelector('${backgroundSurface}')`);
    await evaluate(`Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'))`);
    await until(
      () => evaluate("!document.querySelector('.spectrum-canvas')"),
      "hidden window stops spectrum rendering",
    );
    assert.equal(
      await evaluate(`window.backgroundSurface === document.querySelector('${backgroundSurface}')`),
      true,
      "hidden window retains its background",
    );
    await evaluate(
      "delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))",
    );
    await until(visualizersReady, "background and spectrum restore together");
    assert.equal(
      await evaluate(`window.backgroundSurface === document.querySelector('${backgroundSurface}') &&
        (${previewVisible}) === ${noGpu}`),
      true,
      "restoring the window keeps its background and preview state",
    );
    await evaluate("delete window.backgroundSurface");
    await evaluate(
      `${playerOptions}.playerBgType = 'blur'; ${playerOptions}.enableSpectrum = false`,
    );
    await evaluate(`${status}.fullQueueOpen = true`);
    await until(
      () =>
        evaluate(
          `document.querySelector('.liquid-playing-companion:not([style*="display: none"])')?.textContent.includes('${nextTrack}')`,
        ),
      "song action inserted the selected track into the real queue",
    );
    await evaluate(`${status}.fullQueueOpen = false; ${theme}.options.layout.player = 'apple'`);
    await until(
      () =>
        evaluate(`!document.querySelector('[data-liquid-player]') &&
        !!document.querySelector('[data-player-layout="top-bar"]') &&
        !!document.querySelector('[data-player-cover="full"]')`),
      "Apple layout remains available in Liquid",
    );
    await evaluate(`${theme}.options.layout.player = 'liquid'`);
    await until(
      () => evaluate("!!document.querySelector('[data-liquid-player]')"),
      "return to Liquid player layout",
    );
    await evaluate(`${theme}.themeId = 'classic'; ${theme}.themeId = 'sakura-liquid'`);
    assert.equal(await evaluate(`${status}.currentTrack?.id`), identity);
    assert.equal(await evaluate(`${status}.isPlayerExpanded`), true);
  }

  await send("Page.reload");
  await until(
    () =>
      evaluate(
        `!window.beforeTheme && ${root}.dataset.theme === 'sakura-liquid' && !document.querySelector('#app-loading')`,
      ),
    "persisted Liquid shell",
  );
  assert.equal(await evaluate(`${theme}.mode`), "dark");
  assert.equal(await evaluate(`${theme}.profiles.classic.customColor`), "#638fc7");
  if (!useAudio)
    assert.equal(
      await evaluate(`${theme}.profiles.classic.imageBackground.src`),
      classicBackground,
    );
  if (measureMemory)
    console.log(
      await until(
        () => browserLog.match(/内存占用: [^\r\n]+/)?.[0],
        "startup memory sample",
        75_000,
      ),
    );
  console.log(`Electron theme integration passed on ${process.platform}/${process.arch}`);
} catch (error) {
  console.error(browserLog);
  if (useAudio && socket)
    console.error("Audio engine at failure:", await evaluate(engineState).catch(() => null));
  throw error;
} finally {
  socket?.close();
  child.kill();
  await Promise.race([exited, delay(5000, null, { ref: false })]);
  const owned = relative(tmpdir(), profile);
  if (owned.startsWith("sakura-theme-") && !isAbsolute(owned)) {
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
