import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import DownloadPage from "./DownloadPage.vue";

vi.mock("vitepress", () => ({ useData: () => ({ lang: { value: "en-US" } }) }));

const stable = { tag_name: "v1.2.0", prerelease: false, draft: false, assets: [] };
const beta = { tag_name: "v1.2.0-beta.1", prerelease: true, draft: false, assets: [] };
const alpha = { ...beta, tag_name: "v1.2.0-alpha.1" };
const nightly = { ...beta, tag_name: "nightly" };

afterEach(() => vi.unstubAllGlobals());

describe("下载页初始通道", () => {
  it.each([
    [[beta], "beta", beta.tag_name],
    [[beta, stable], "stable", stable.tag_name],
    [[{ ...stable, draft: true }, beta], "beta", beta.tag_name],
    [[{ ...beta, draft: true }, alpha, nightly], "stable", null],
    [[], "stable", null],
  ])("根据公开发行列表选择初始通道", async (releases, channel, tag) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => releases }));
    const wrapper = mount(DownloadPage);
    await flushPromises();
    expect((wrapper.find("select").element as HTMLSelectElement).value).toBe(channel);
    if (tag) expect(wrapper.find(".dl-ver").text()).toBe(tag);
    else expect(wrapper.find(".dl-ver-empty").exists()).toBe(true);
    wrapper.unmount();
  });

  it("自动选择 Beta 后仍可手动切换空的 Stable 和 Alpha 通道", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [beta, alpha] }),
    );
    const wrapper = mount(DownloadPage);
    await flushPromises();
    await wrapper.find("select").setValue("stable");
    expect(wrapper.find(".dl-ver-empty").exists()).toBe(true);
    await wrapper.find("select").setValue("alpha");
    expect(wrapper.find(".dl-ver").text()).toBe(alpha.tag_name);
    await wrapper.find("select").setValue("beta");
    expect(wrapper.find(".dl-ver").text()).toBe(beta.tag_name);
    wrapper.unmount();
  });
});
