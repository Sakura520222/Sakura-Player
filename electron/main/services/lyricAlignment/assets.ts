export interface AlignmentDownload {
  url: string;
  size: number;
  sha256: string;
}

export const ALIGNMENT_ENVIRONMENT_VERSION = 1;
export const ALIGNMENT_PYTHON_VERSION = "3.12.15";
const release = "20261013";

// 固定上游不可变发行资产的 SHA-256，安装时不解析可变的 latest 地址
const pythonAssets: Record<string, { triple: string; size: number; sha256: string }> = {
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    size: 22019610,
    sha256: "7a2aef48e5ee569e310b29b32681debbc5d888e92790d85331a47736c6b06aad",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    size: 24774808,
    sha256: "d09998f85752b646873a8a6bc7eea442a0d251b1c8d2413aa8ea06ef131c3335",
  },
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    size: 25052618,
    sha256: "9866e11cf2ae9caa1e671383786f248859a52dd8bfb702fb4c0dc2c65f1d36de",
  },
  "linux-x64": {
    triple: "x86_64-unknown-linux-gnu",
    size: 34340172,
    sha256: "178d3d83b6e8e99285a65d3fce9c16b87952cc5efdb4d1a0e3ff3be18ff0fc9c",
  },
  "linux-arm64": {
    triple: "aarch64-unknown-linux-gnu",
    size: 29242161,
    sha256: "9467a99bacc7d90b64b02de7fa9ecfc99b72905e64e74f7ff6b460ad95cfed5a",
  },
};

/**
 * 选择固定的便携解释器，Windows ARM64 使用可运行 PyTorch 的 x64 环境
 * @param platform - 应用运行平台
 * @param arch - 应用进程架构
 * @returns 已知平台的校验资产，不支持的平台返回 null
 */
export const getAlignmentPythonDownload = (
  platform = process.platform,
  arch = process.arch,
): AlignmentDownload | null => {
  const target =
    pythonAssets[`${platform}-${platform === "win32" && arch === "arm64" ? "x64" : arch}`];
  if (!target) return null;
  return {
    url: `https://github.com/astral-sh/python-build-standalone/releases/download/${release}/cpython-${ALIGNMENT_PYTHON_VERSION}%2B${release}-${target.triple}-install_only_stripped.tar.gz`,
    size: target.size,
    sha256: target.sha256,
  };
};

export const ALIGNMENT_MODEL_REVISION = "3f076fdb1ab68d5b2880cb87a0886f315b8146f8";
export const ALIGNMENT_MODEL_FILES = [
  {
    name: "config.json",
    size: 625,
    sha256: "4d10c2021c6b5fbe8b70698abc6ccc6691dc28d1bae9732f7fa1087782feba7e",
  },
  {
    name: "vocab.txt",
    size: 995526,
    sha256: "fe0fda7c425b48c516fc8f160d594c8022a0808447475c1a7c6d6479763f310c",
  },
  {
    name: "tokenizer_config.json",
    size: 49,
    sha256: "0f6d13e6f4da6f9e24f22ada6bc3be571123d858d7c0c05a8a7cd55a9c23c2e8",
  },
  {
    name: "tokenizer.json",
    size: 1961828,
    sha256: "f4a4d5bf7301717e261fafbe26e1eb967f6ba4cb3ae0ab7a29f4642ec229f386",
  },
  {
    name: "model.safetensors",
    size: 714290682,
    sha256: "876f584f15ebf14887dec17539c114bb99a032e96b9e72507a51c41e205337fc",
  },
  {
    name: "README.md",
    size: 7104,
    sha256: "f68ac58055880eebf82c52b1371528e7a254027211257e9100f574baf9d1b517",
  },
].map((file) => ({
  ...file,
  url: `https://huggingface.co/google-bert/bert-base-multilingual-cased/resolve/${ALIGNMENT_MODEL_REVISION}/${file.name}`,
}));
