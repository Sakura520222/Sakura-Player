/** 算法只关联已有文本，不生成或替换原文 */
export interface AlignmentPart {
  text: string;
  from: number;
  to: number;
}

export interface AlignmentSourceLine {
  id: number;
  words: string[];
  /** 主歌词自带的逐词假名，空项交给词典补充 */
  readings?: string[];
  translation: string;
  romanization: string;
  /** 只有逐行时间的主歌词，单位为毫秒 */
  primary?: { startTime: number; endTime: number };
}

/** 短语关联语义分词的下标，时间仍通过分词对应的主歌词范围获取 */
export interface AlignmentSourcePhrase {
  text: string;
  indices: number[];
  /** 短语中可独立承担语义的分词下标 */
  heads?: number[];
  /** 与 indices 同序的词典基本形，仅用于语义回退 */
  lemmas?: string[];
}

export interface AlignmentTrackResult {
  parts: AlignmentPart[];
  /** 匹配评分，不表示校准后的正确率 */
  score: number;
}

export interface AlignmentLineResult {
  id: number;
  translation?: AlignmentTrackResult;
  romanization?: AlignmentTrackResult;
  primary?: PrimaryAlignmentResult;
  reason?: string;
}

export type AlignmentLanguage = "zh" | "ja" | "en";
export type AlignmentModelKind = "translation" | "acoustic";

export interface PrimaryAlignmentResult {
  words: { word: string; startTime: number; endTime: number }[];
  /** 声学评分仅供筛选，不表示正确率 */
  score: number;
  /** 低可信度或未知读音等需要人工检查的原因 */
  warnings?: string[];
}

export interface LocalAlignmentRequest {
  requestId: string;
  lines: AlignmentSourceLine[];
  translation: boolean;
  romanization: boolean;
  primary?: { trackId: string; language: AlignmentLanguage };
}

export type AlignmentEnvironmentPhase =
  | "not-installed"
  | "downloading-model"
  | "verifying"
  | "ready"
  | "cancelling"
  | "uninstalling"
  | "error";

export interface AlignmentEnvironmentState {
  revision: number;
  phase: AlignmentEnvironmentPhase;
  installed: boolean;
  hasFiles: boolean;
  supported: boolean;
  inUse: boolean;
  downloadedBytes: number;
  totalBytes: number;
  detail: string;
  error: string;
}

export type LocalAlignmentResponse =
  | { status: "completed"; lines: AlignmentLineResult[]; translationError?: string }
  | { status: "cancelled" }
  | { status: "error"; error: string };

export interface LyricAlignmentApi {
  /** 在可取消的本地工作进程中匹配已有辅助歌词 */
  align: (request: LocalAlignmentRequest) => Promise<LocalAlignmentResponse>;
  /** 取消本窗口的对齐任务并释放词典及模型 */
  cancel: (requestId: string) => Promise<boolean>;
  /** 获取本地对齐模型的准备状态 */
  environmentStatus: (kind?: AlignmentModelKind) => Promise<AlignmentEnvironmentState>;
  /** 仅由用户点击触发，下载或复用并校验本地模型 */
  installEnvironment: (kind?: AlignmentModelKind) => Promise<AlignmentEnvironmentState>;
  /** 中止模型准备并清理本次新建的未完成模型 */
  cancelEnvironmentInstall: (kind?: AlignmentModelKind) => Promise<boolean>;
  /** 手动移除本地对齐模型 */
  uninstallEnvironment: (kind?: AlignmentModelKind) => Promise<AlignmentEnvironmentState>;
  /** 模型维护期间关闭到后台，返回是否已隐藏当前窗口 */
  continueInBackground: () => Promise<boolean>;
  /** 订阅有界的下载进度与模型状态 */
  onEnvironmentStatus: (
    callback: (state: AlignmentEnvironmentState) => void,
    kind?: AlignmentModelKind,
  ) => () => void;
}
