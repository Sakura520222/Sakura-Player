/** 有界提取 JSON 对象，兼容逐行、缩进、数组和代码块排版 */
export class JsonRecordDecoder {
  private buffer = "";
  private length = 0;
  private scan = 0;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private end = 0;
  private started = false;
  private array: "none" | "first" | "next" | "separator" | "closed" = "none";

  /**
   * 交由调用方校验记录内容，排版兼容不会修补数据或放宽行号校验
   * @param onRecord - 完整对象文本的校验与提交回调
   * @param maxRecordCharacters - 单个对象的字符上限
   */
  constructor(
    private readonly onRecord: (record: string) => void,
    private readonly maxRecordCharacters: number,
  ) {}

  /**
   * 接收任意流式分片，只处理边界完整的 JSON 对象
   * @param delta - 本次收到的文本
   */
  push(delta: string): void {
    this.length += delta.length;
    if (this.length > 1024 * 1024) throw new Error("歌词响应超过大小限制");
    this.buffer += delta;
    this.drain(false);
  }

  /** 提交无尾换行的对象，拒绝截断的对象或未闭合的数组 */
  finish(): void {
    this.drain(true);
    if (this.buffer.trim() || !["none", "closed"].includes(this.array))
      throw new Error("歌词 JSON 不完整");
  }

  /**
   * 按字符串转义与嵌套边界提取记录，不把缩进换行误判为记录结束
   * @param final - 是否已收到响应末尾
   */
  private drain(final: boolean): void {
    while (true) {
      if (this.scan === 0) {
        this.buffer = this.buffer.trimStart();
        if (!this.buffer) return;
        if (this.buffer.startsWith("`")) {
          const newline = this.buffer.indexOf("\n");
          if (newline < 0 && !final) return;
          const end = newline < 0 ? this.buffer.length : newline;
          if (!/^```(?:jsonl?|ndjson)?$/i.test(this.buffer.slice(0, end).trim()))
            throw new Error("歌词 JSON 代码块格式无效");
          this.buffer = this.buffer.slice(newline < 0 ? end : end + 1);
          continue;
        }
        if (this.array === "separator") {
          if (this.buffer[0] === ",") this.array = "next";
          else if (this.buffer[0] === "]") this.array = "closed";
          else throw new Error("歌词 JSON 数组格式无效");
          this.buffer = this.buffer.slice(1);
          continue;
        }
        if (this.buffer[0] === "[" && !this.started && this.array === "none") {
          this.array = "first";
          this.buffer = this.buffer.slice(1);
          continue;
        }
        if (this.buffer[0] === "]" && this.array === "first") {
          this.array = "closed";
          this.buffer = this.buffer.slice(1);
          continue;
        }
        if (this.buffer[0] !== "{" || this.array === "closed")
          throw new Error("歌词 JSON 记录格式无效");
      }
      while (!this.end && this.scan < this.buffer.length) {
        const character = this.buffer[this.scan++];
        if (this.scan > this.maxRecordCharacters) throw new Error("歌词记录过长");
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (character === "\\") this.escaped = true;
          else if (character === '"') this.quoted = false;
        } else if (character === '"') this.quoted = true;
        else if (character === "{" || character === "[") this.depth++;
        else if (character === "}" || character === "]") {
          this.depth--;
          if (this.depth === 0) this.end = this.scan;
        }
      }
      if (!this.end || (this.end === this.buffer.length && !final)) return;
      const record = this.buffer.slice(0, this.end);
      this.buffer = this.buffer.slice(this.end);
      this.scan = 0;
      this.end = 0;
      this.started = true;
      if (this.array === "first" || this.array === "next") this.array = "separator";
      this.onRecord(record);
    }
  }
}
