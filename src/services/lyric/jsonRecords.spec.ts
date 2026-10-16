import { describe, expect, it } from "vitest";
import { JsonRecordDecoder } from "./jsonRecords";

const values = [
  { id: 0, text: '保留 {括号}、[数组]、"引号" 和 \\ 转义', parts: [{ index: 0, text: "kimi" }] },
  { id: 2, text: "另一行 🌸" },
];

describe("歌词 JSON 流式排版兼容", () => {
  it.each([
    values.map((value) => JSON.stringify(value)).join("\n"),
    values.map((value) => JSON.stringify(value, null, 2)).join("\n"),
    JSON.stringify(values),
    JSON.stringify(values, null, 2),
    "```json\n" + JSON.stringify(values, null, 2) + "\n```",
    "```jsonl\r\n" + values.map((value) => JSON.stringify(value)).join("\r\n") + "\r\n```",
  ])("任意字符分片保留完整对象和嵌套字符串：%s", (text) => {
    const records: unknown[] = [];
    const decoder = new JsonRecordDecoder((record) => records.push(JSON.parse(record)), 65536);
    for (const character of text) decoder.push(character);
    decoder.finish();
    expect(records).toEqual(values);
  });

  it.each([
    '[{"id":0},',
    '[{"id":0},{"id":1',
    '[{"id":0},]',
    '[{"id":0}] {"id":1}',
    '[{"id":0} {"id":1}]',
    '{"id":0}\n模型补充说明',
  ])("拒绝截断或非法封装，同时保留此前完整对象：%s", (text) => {
    const records: unknown[] = [];
    const decoder = new JsonRecordDecoder((record) => records.push(JSON.parse(record)), 65536);
    expect(() => {
      decoder.push(text);
      decoder.finish();
    }).toThrow();
    expect(records).toEqual([{ id: 0 }]);
  });

  it("损坏或内容校验不通过的对象不会提交，之前的记录仍保留", () => {
    const records: unknown[] = [];
    const decoder = new JsonRecordDecoder((record) => records.push(JSON.parse(record)), 65536);
    expect(() => decoder.push('{"id":0}\n{"id":bad}\n')).toThrow();
    expect(records).toEqual([{ id: 0 }]);
  });

  it("单条与整次响应均有上限，数组排版不会绕过限制", () => {
    const record = JSON.stringify(values[0]);
    const valid = new JsonRecordDecoder(() => {}, record.length);
    valid.push(record);
    expect(() => valid.finish()).not.toThrow();
    expect(() => new JsonRecordDecoder(() => {}, record.length - 1).push(record)).toThrow(/过长/);
    expect(() => new JsonRecordDecoder(() => {}, 65536).push(" ".repeat(1024 * 1024 + 1))).toThrow(
      /大小限制/,
    );
  });
});
