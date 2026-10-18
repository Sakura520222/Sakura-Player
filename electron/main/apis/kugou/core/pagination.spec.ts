import { describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "./pagination";

describe("KG 完整列表分页", () => {
  it("不足一页或空列表时不请求后续页", async () => {
    for (const items of [[], [1, 2]]) {
      const request = vi.fn(async () => ({ items, total: items.length }));
      await expect(fetchAllPages(request, 300)).resolves.toEqual({ items, total: items.length });
      expect(request).toHaveBeenCalledExactlyOnceWith(1);
    }
  });

  it("完整取回超过 300 首的列表并保持服务端顺序", async () => {
    const songs = Array.from({ length: 832 }, (_, index) => index + 1);
    const request = vi.fn(async (page: number) => ({
      items: songs.slice((page - 1) * 300, page * 300),
      total: songs.length,
    }));
    await expect(fetchAllPages(request, 300)).resolves.toEqual({ items: songs, total: 832 });
    expect(request.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("总数为整页时不多取一页，并裁掉服务端超额返回的条目", async () => {
    const request = vi.fn(async (page: number) => ({
      items: Array.from({ length: 3 }, (_, index) => (page - 1) * 3 + index + 1),
      total: 6,
    }));
    await expect(fetchAllPages(request, 3)).resolves.toEqual({
      items: [1, 2, 3, 4, 5, 6],
      total: 6,
    });
    expect(request).toHaveBeenCalledTimes(2);
    await expect(fetchAllPages(async () => ({ items: [1, 2, 3], total: 2 }), 3)).resolves.toEqual({
      items: [1, 2],
      total: 2,
    });
  });

  it("并发有界且页面完成顺序不改变列表顺序", async () => {
    let active = 0;
    let peak = 0;
    const request = vi.fn(async (page: number) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, (9 - page) % 3));
      active--;
      return { items: [page], total: 8 };
    });
    await expect(fetchAllPages(request, 1)).resolves.toEqual({
      items: [1, 2, 3, 4, 5, 6, 7, 8],
      total: 8,
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(request).toHaveBeenCalledTimes(8);
  });

  it("缺少总数时持续拉取到短页，保留超过一页的歌曲", async () => {
    const request = vi.fn(async (page: number) => ({
      items: [[1, 2], [3, 4], [5]][page - 1],
    }));
    await expect(fetchAllPages(request, 2)).resolves.toEqual({ items: [1, 2, 3, 4, 5], total: 5 });
    expect(request.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it("缺少总数且恰好整页时在空页停止", async () => {
    const request = vi.fn(async (page: number) => ({ items: page === 1 ? [1, 2] : [] }));
    await expect(fetchAllPages(request, 2)).resolves.toEqual({ items: [1, 2], total: 2 });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([1, 2])("第 %s 页失败时拒绝返回不完整列表", async (failedPage) => {
    const error = new Error("网络失败");
    const request = vi.fn(async (page: number) => {
      if (page === failedPage) throw error;
      return { items: [page], total: 3 };
    });
    await expect(fetchAllPages(request, 1)).rejects.toBe(error);
  });

  it("实际条目少于服务端总数时明确报错", async () => {
    await expect(fetchAllPages(async () => ({ items: [1], total: 5 }), 3)).rejects.toThrow(
      "KG 列表数据不完整",
    );
  });
});
