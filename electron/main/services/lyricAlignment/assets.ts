export interface AlignmentDownload {
  url: string;
  size: number;
  sha256: string;
}

export const ALIGNMENT_ENVIRONMENT_VERSION = 1;
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
