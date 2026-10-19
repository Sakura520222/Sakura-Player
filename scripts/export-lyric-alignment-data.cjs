const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const directory = process.argv[2];
if (!directory)
  throw new Error("用法：node scripts/export-lyric-alignment-data.cjs <kuromoji-0.1.2-包目录>");
const source = path.resolve(directory);
const metadata = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8"));
if (metadata.name !== "kuromoji" || metadata.version !== "0.1.2")
  throw new Error("必须使用固定版本 kuromoji 0.1.2");
const kuromoji = require(source);
kuromoji.builder({ dicPath: path.join(source, "dict") }).build((error, tokenizer) => {
  if (error) throw error;
  const dictionary = tokenizer.token_info_dictionary;
  const entries = new Map();
  const ties = new Map();
  for (let id = 0; id < dictionary.dictionary.buffer.length; id += 10) {
    const fields = dictionary.getFeatures(String(id)).split(",");
    if (!fields[0]) continue;
    const readings = entries.get(fields[0]) ?? [];
    for (const value of [fields[8], fields[9]])
      if (value && value !== "*" && !readings.includes(value)) readings.push(value);
    entries.set(fields[0], readings);
    const key = JSON.stringify([dictionary.dictionary.getShort(id + 4), ...fields.slice(0, 8)]);
    const previous = ties.get(key) ?? [];
    if (!previous.some((value) => value[0] === fields[8] && value[1] === fields[9]))
      previous.push([fields[8] ?? "", fields[9] ?? ""]);
    ties.set(key, previous);
  }
  const data = {
    readings: Object.fromEntries(
      [...entries].filter(([, values]) => values.length > 1).sort(([a], [b]) => a.localeCompare(b)),
    ),
    ties: Object.fromEntries(
      [...ties].filter(([, values]) => values.length > 1).map(([key, values]) => [key, values[0]]),
    ),
  };
  const destination = path.resolve("native/lyric-alignment/data/ipadic-compat.json.gz");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, zlib.gzipSync(JSON.stringify(data), { level: 9 }));
  console.log(
    `已导出 ${Object.keys(data.readings).length} 组候选顺序和 ${Object.keys(data.ties).length} 组同分读音`,
  );
});
