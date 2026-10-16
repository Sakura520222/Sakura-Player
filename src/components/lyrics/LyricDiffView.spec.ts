import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { describe, expect, it } from "vitest";
import zh from "@/i18n/locales/zh-CN.json";
import LyricDiffView from "./LyricDiffView.vue";

const render = (before: string, after: string) =>
  mount(LyricDiffView, {
    props: { before, after },
    global: {
      plugins: [createI18n({ legacy: false, locale: "zh-CN", messages: { "zh-CN": zh } })],
      stubs: {
        SVirtualList: {
          props: ["items"],
          template: "<div><slot v-for='item in items' :item='item'/></div>",
        },
      },
    },
  });

describe("歌词更改 diff", () => {
  it("逐字时间与文本的变化显示为删除和新增，原始 XML 作为文字呈现", () => {
    const before = "[1000,2000](1000,1000,0)旧词\n未变歌词\n";
    const after = '<span begin="1.234s">新词</span>\n未变歌词\n';
    const wrapper = render(before, after);
    expect(wrapper.get('[data-diff="removed"]').text()).toContain("(1000,1000,0)旧词");
    expect(wrapper.get('[data-diff="added"]').text()).toContain('<span begin="1.234s">新词</span>');
    expect(wrapper.get('[data-diff="context"]').text()).toContain("未变歌词");
    expect(wrapper.find("span[begin]").exists()).toBe(false);
    expect(wrapper.text()).toContain("+1");
    expect(wrapper.text()).toContain("−1");
    wrapper.unmount();
  });

  it("相同内容显示无变化，换行符与末尾换行的差异不会被隐藏", () => {
    const same = render("歌词\n", "歌词\n");
    expect(same.text()).toContain("内容无变化");
    same.unmount();
    const endings = render("歌词\r\n", "歌词");
    expect(endings.text()).toContain("换行符: CRLF → —");
    expect(endings.text()).toContain("文件末尾没有换行符");
    expect(endings.findAll('[data-diff="added"]')).toHaveLength(1);
    expect(endings.findAll('[data-diff="removed"]')).toHaveLength(1);
    endings.unmount();
  });
});
