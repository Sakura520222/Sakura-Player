const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const engine = require("../audio-engine.node");

const duration = 10;
const ffmpeg = (arguments_) => {
  const result = spawnSync(
    "ffmpeg",
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...arguments_],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.error);
  return result.stdout.trim();
};
const hash = (path) =>
  ffmpeg(["-i", path, "-map", "0:a:0", "-c:a", "pcm_s32le", "-f", "hash", "-hash", "sha256", "-"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 合成低电平的宽频立体声，同时保留低位变化供逐样本检查 */
function wave(path, bits, rate) {
  const frames = rate * duration;
  const blockAlign = 2 * (bits / 8);
  const raw = Buffer.alloc(44 + frames * blockAlign);
  raw.write("RIFF", 0);
  raw.writeUInt32LE(raw.length - 8, 4);
  raw.write("WAVEfmt ", 8);
  raw.writeUInt32LE(16, 16);
  raw.writeUInt16LE(1, 20);
  raw.writeUInt16LE(2, 22);
  raw.writeUInt32LE(rate, 24);
  raw.writeUInt32LE(rate * blockAlign, 28);
  raw.writeUInt16LE(blockAlign, 32);
  raw.writeUInt16LE(bits, 34);
  raw.write("data", 36);
  raw.writeUInt32LE(raw.length - 44, 40);
  let state = 0x141a2fc;
  for (let offset = 44; offset < raw.length; offset += bits / 8) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const sample = state >> (32 - bits + 6);
    raw.writeIntLE(sample, offset, bits / 8);
  }
  writeFileSync(path, raw);
}

/** 使用真实容器和编码构建可重复生成的文件夹具 */
function makeFixtures(root) {
  const wav16 = join(root, "音频 16.wav");
  const wav24 = join(root, "音频 24.wav");
  const wav32 = join(root, "音频 32.wav");
  wave(wav16, 16, 44100);
  wave(wav24, 24, 48000);
  wave(wav32, 32, 48000);
  const formats = [
    { extension: "wav", codec: "pcm_s16le", writable: true, path: wav16 },
    { extension: "wav", codec: "pcm_s24le", writable: true, path: wav24 },
    { extension: "wav", codec: "pcm_s32le", writable: true, path: wav32 },
    { extension: "flac", codec: "flac", writable: true, encoder: "flac", source: wav24 },
    {
      extension: "mp3",
      codec: "mp3",
      writable: true,
      encoder: "libmp3lame",
      args: ["-b:a", "128k"],
    },
    { extension: "m4a", codec: "aac", writable: true, encoder: "aac" },
    { extension: "m4b", codec: "alac", writable: true, encoder: "alac" },
    { extension: "oga", codec: "vorbis", writable: true, encoder: "libvorbis" },
    { extension: "opus", codec: "opus", writable: true, encoder: "libopus" },
    { extension: "aiff", codec: "pcm_s24be", writable: true, encoder: "pcm_s24be", source: wav24 },
    { extension: "wv", codec: "wavpack", writable: true, encoder: "wavpack" },
    { extension: "tta", codec: "tta", writable: true, encoder: "tta" },
    { extension: "wma", codec: "wmav2", writable: false, encoder: "wmav2" },
  ];
  for (const f of formats) {
    if (f.path) continue;
    f.path = join(root, "音频." + f.extension);
    ffmpeg([
      "-i",
      f.source || wav16,
      "-map_metadata",
      "-1",
      "-c:a",
      f.encoder,
      ...(f.args || []),
      f.path,
    ]);
  }
  const chapters = join(root, "chapters.txt");
  writeFileSync(
    chapters,
    ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=3000\ntitle=序章\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=3000\nEND=10000\ntitle=终章\n",
  );
  const book = join(root, "有声书.m4b");
  ffmpeg([
    "-i",
    wav16,
    "-i",
    chapters,
    "-map",
    "0:a",
    "-map_metadata",
    "1",
    "-map_chapters",
    "1",
    "-c:a",
    "alac",
    book,
  ]);
  return { formats, book };
}

test("扫描、标签写入与独立解码检查覆盖多种真实容器", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sakura-audio-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const { formats, book } = makeFixtures(root);
  for (const item of formats) {
    await t.test(item.codec, async () => {
      const info = await engine.inspectAudioFile(item.path);
      assert.equal(info.codec, item.codec);
      assert.ok(info.sampleRate > 0);
      assert.equal(info.channels, 2);
      const decoded = await engine.analyzeAudioSpectrum(item.path, 0, 2000);
      assert.ok(decoded.analyzedSeconds > 1, "原生解码器应返回可分析的 PCM");
      const tags = await engine.readTrackTags(item.path);
      assert.equal(tags.writable, item.writable);
      if (!item.writable) return;
      const before = hash(item.path);
      const [outcome] = await engine.writeTrackTags([
        {
          path: item.path,
          title: "测试作品",
          artists: ["Earth, Wind & Fire", "A/B"],
          album: "音乐专辑",
          trackNumber: 2,
          trackTotal: 9,
          discNumber: 1,
          lyrics: "[00:02.00]测试歌词",
          expectedRevision: tags.revision,
        },
      ]);
      assert.equal(outcome.success, true, outcome.error);
      const actual = await engine.readTrackTags(item.path);
      assert.equal(actual.title, "测试作品");
      assert.deepEqual(actual.artists, ["Earth, Wind & Fire", "A/B"]);
      assert.equal(actual.trackNumber, 2);
      assert.equal(actual.trackTotal, 9);
      assert.equal(actual.lyrics, "[00:02.00]测试歌词");
      assert.equal(hash(item.path), before);
      assert.deepEqual(outcome.track.tags.artists, actual.artists);
      const bytes = readFileSync(item.path);
      const [stale] = await engine.writeTrackTags([
        { path: item.path, title: "过期字段", expectedRevision: tags.revision },
      ]);
      assert.equal(stale.success, false);
      assert.deepEqual(readFileSync(item.path), bytes);
    });
  }
  const original = await engine.inspectAudioFile(book);
  const [chapterEdit] = await engine.writeTrackTags([{ path: book, title: "保留章节的标题修改" }]);
  assert.equal(chapterEdit.success, true, chapterEdit.error);
  const info = await engine.inspectAudioFile(book);
  assert.deepEqual(info.chapters, original.chapters);
  assert.deepEqual(
    info.chapters.map(({ startMs, title }) => [startMs, title]),
    [
      [0, "序章"],
      [3000, "终章"],
    ],
  );
  const invalid = join(root, "corrupt.mp3");
  closeSync(openSync(invalid, "w"));
  const paths = await new Promise((resolve) => {
    const found = [];
    engine.scanDirs([root], (event) => {
      if (event.eventType === "progress") found.push(...event.tracks.map((track) => track.path));
      if (event.eventType === "done") resolve(found.sort());
    });
  });
  assert.deepEqual(paths, [...formats.map((f) => f.path), book].sort());
});

test("频谱可以区分宽频整数 PCM 与有一致截止的转码样本", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sakura-spectrum-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const source = join(root, "wide.wav");
  const lowpassed = join(root, "lowpassed.flac");
  wave(source, 24, 48000);
  ffmpeg([
    "-i",
    source,
    "-af",
    "afftfilt=real='if(lt(b,0.66*nb),re,0)':imag='if(lt(b,0.66*nb),im,0)'",
    "-c:a",
    "flac",
    lowpassed,
  ]);
  const wide = await engine.analyzeAudioSpectrum(source, 0);
  assert.equal(wide.windows, 3);
  assert.equal(wide.partial, false);
  assert.equal(wide.observedIntegerBits, 24);
  assert.equal(wide.cutoffHz, undefined);
  const canceled = engine.analyzeAudioSpectrum(source, 0, undefined, "cancel-before-decoding");
  engine.cancelAudioSpectrum("cancel-before-decoding");
  await assert.rejects(canceled, /音质分析已取消/);
  const limited = await engine.analyzeAudioSpectrum(lowpassed, 0);
  assert.equal(limited.windows, 3);
  assert.ok(limited.cutoffHz > 17300 && limited.cutoffHz < 18400, JSON.stringify(limited));

  const mp3Input = join(root, "mp3-input.wav");
  wave(mp3Input, 16, 44100);
  const mp3 = join(root, "lossy-source.mp3");
  const disguised = join(root, "lossy-to-flac.flac");
  ffmpeg(["-i", mp3Input, "-c:a", "libmp3lame", "-b:a", "128k", "-cutoff", "16000", mp3]);
  ffmpeg(["-i", mp3, "-c:a", "flac", disguised]);
  const transcoded = await engine.analyzeAudioSpectrum(disguised, 0);
  assert.equal(transcoded.windows, 3);
  assert.ok(transcoded.cutoffHz > 15300 && transcoded.cutoffHz < 17500, JSON.stringify(transcoded));
});

test("频谱遇到无效 FLAC 帧仍保留读出的片段", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "sakura-spectrum-corrupt-flac-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const source = join(root, "source.wav");
  const damaged = join(root, "damaged.flac");
  wave(source, 16, 44100);
  ffmpeg(["-i", source, "-c:a", "flac", damaged]);

  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "packet=pos,size,pts_time",
      "-of",
      "json",
      damaged,
    ],
    { encoding: "utf8" },
  );
  assert.equal(probe.status, 0, probe.stderr || probe.error);
  const packet = JSON.parse(probe.stdout).packets.find(
    (candidate) => Number(candidate.pts_time) > 9,
  );
  assert.ok(packet, "需要一个位于曲尾分析窗口的 FLAC 帧");

  const data = readFileSync(damaged);
  const frame = data.subarray(Number(packet.pos), Number(packet.pos) + Number(packet.size));
  const blockCode = frame[2] >> 4;
  const rateCode = frame[2] & 0x0f;
  const indexBytes = Math.max(1, Math.clz32((~frame[4] & 0xff) << 24));
  const blockBytes = blockCode === 6 ? 1 : blockCode === 7 ? 2 : 0;
  const rateBytes = rateCode === 12 ? 1 : rateCode === 13 || rateCode === 14 ? 2 : 0;
  // 写入保留的子帧编码类型并更新 CRC，保证错误发生在解码阶段
  frame[5 + indexBytes + blockBytes + rateBytes] = 0x04;
  let crc = 0;
  for (const value of frame.subarray(0, -2)) {
    crc ^= value << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x8005 : 0)) & 0xffff;
    }
  }
  frame.writeUInt16BE(crc, frame.length - 2);
  writeFileSync(damaged, data);

  const spectrum = await engine.analyzeAudioSpectrum(damaged, 0);
  assert.equal(spectrum.partial, true);
  assert.ok(spectrum.analyzedSeconds >= 6);
  assert.ok(spectrum.windows >= 2);
  assert.ok(spectrum.relativeBandsDb.length > 0);
  assert.equal(spectrum.cutoffHz, undefined);
});

test(
  "通过真实 Windows 设备逐样本核对直通 PCM",
  {
    skip: process.platform !== "win32" || process.env.SAKURA_TEST_WASAPI_DIRECT !== "1",
  },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "sakura-wasapi-"));
    const player = new engine.AudioPlayer();
    t.after(() => {
      player.stop();
      rmSync(root, { force: true, recursive: true });
    });
    if (process.env.SAKURA_TEST_WASAPI_DEVICE) {
      await player.setOutputDevice(process.env.SAKURA_TEST_WASAPI_DEVICE);
    }
    await player.setExclusiveMode(true, true);
    let verified = 0;
    for (const [bits, rate] of [
      [16, 48000],
      [16, 44100],
      [24, 48000],
      [32, 48000],
    ]) {
      const path = join(root, "direct-" + bits + ".wav");
      wave(path, bits, rate);
      // 直通绕开软件音量，夹具本身保持低电平
      player.setVolume(0.1);
      await player.load(path, true);
      await sleep(500);
      const stream = player.getStreamInfo();
      t.diagnostic(bits + " bit / " + rate + " Hz " + JSON.stringify(stream));
      if (stream.directStatus === "unavailable") {
        assert.equal(stream.verifiedFrames, 0);
        assert.ok(["formatMismatch", "endpointUnavailable"].includes(stream.directReason));
        player.stop();
        continue;
      }
      assert.equal(stream.directStatus, "verified", JSON.stringify(stream));
      verified += 1;
      assert.equal(stream.sourceBits, bits);
      assert.equal(stream.outputSampleRate, rate);
      assert.equal(stream.isResampling, false);
      assert.ok(stream.verifiedFrames > 1000);
      await player.seek(3);
      await sleep(250);
      assert.equal(player.getStreamInfo().directStatus, "verified");
      player.stop();
    }
    assert.ok(verified > 0, "设备没有验证通过的 PCM 格式");
  },
);
