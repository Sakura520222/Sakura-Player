import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerThemeIpc } from "./theme";

const ipc = vi.hoisted(() => ({
  root: "",
  select: vi.fn<(options: unknown) => Promise<{ canceled: boolean; filePaths: string[] }>>(),
  handlers: new Map<string, (_event: unknown, id: string) => Promise<string | null | void>>(),
}));

vi.mock("electron", () => ({
  dialog: { showOpenDialog: ipc.select },
  ipcMain: { handle: (channel: string, handler: never) => ipc.handlers.set(channel, handler) },
}));
vi.mock("@main/utils/config", () => ({
  getBackgroundsDir: () => path.join(ipc.root, "backgrounds"),
}));
vi.mock("@main/utils/protocol", () => ({
  toCacheUrl: (filename: string) =>
    `cache://${path.relative(ipc.root, filename).split(path.sep).join("/")}`,
}));
vi.mock("@main/utils/logger", () => ({ systemLog: { warn: vi.fn(), error: vi.fn() } }));

beforeEach(async () => {
  ipc.root = await mkdtemp(path.join(tmpdir(), "sakura-background-"));
  ipc.handlers.clear();
  await mkdir(path.join(ipc.root, "backgrounds"));
  registerThemeIpc();
});

afterEach(async () => {
  await rm(ipc.root, { recursive: true, force: true });
});

/**
 * 触发一次模拟文件选择，写入真实隔离目录
 * @param id - 要设置图片的主题
 * @param content - 区分样本的内容
 */
async function pick(id: string, content: string) {
  const file = path.join(ipc.root, `${content}.png`);
  await writeFile(file, content);
  ipc.select.mockResolvedValueOnce({ canceled: false, filePaths: [file] });
  return ipc.handlers.get("theme:pickBackgroundImage")!(undefined, id) as Promise<string>;
}

describe("主题背景缓存", () => {
  it("替换和清除 Liquid 背景不会删除旧版 Classic 图片", async () => {
    const prior = path.join(ipc.root, "backgrounds", "a123456789012345.png");
    await writeFile(prior, "legacy");
    const first = await pick("sakura-liquid", "liquid-one");
    const selected = await pick("sakura-liquid", "liquid-two");
    expect(selected).toMatch(/^cache:\/\/backgrounds\/theme-sakura-liquid\//);
    expect(await readFile(path.join(ipc.root, selected.slice(8)), "utf8")).toBe("liquid-two");
    await expect(readFile(path.join(ipc.root, first.slice(8)), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await ipc.handlers.get("theme:clearBackgroundImages")!(undefined, "sakura-liquid");
    expect(await readFile(prior, "utf8")).toBe("legacy");
  });

  it("Classic 清理直接缓存文件而保留其他主题目录", async () => {
    const liquid = await pick("sakura-liquid", "liquid");
    const classic = await pick("classic", "classic");
    expect(classic).toMatch(/^cache:\/\/backgrounds\/[a-f0-9]{16}\.png$/);
    await ipc.handlers.get("theme:clearBackgroundImages")!(undefined, "classic");
    expect(await readdir(path.join(ipc.root, "backgrounds"))).toEqual(["theme-sakura-liquid"]);
    expect(await readFile(path.join(ipc.root, liquid.slice(8)), "utf8")).toBe("liquid");
  });
});
