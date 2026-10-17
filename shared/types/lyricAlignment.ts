/** 算法只关联已有文本，不生成或替换原文 */
export interface AlignmentPart {
  text: string;
  from: number;
  to: number;
}

export interface AlignmentSourceLine {
  id: number;
  words: string[];
  translation: string;
  romanization: string;
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
}

export interface LocalAlignmentRequest {
  requestId: string;
  lines: AlignmentSourceLine[];
  translation: boolean;
  romanization: boolean;
}

export type AlignmentEnvironmentPhase =
  | "not-installed"
  | "downloading-python"
  | "extracting-python"
  | "creating-environment"
  | "installing-dependencies"
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
  /** 获取播放器专用环境的安装状态 */
  environmentStatus: () => Promise<AlignmentEnvironmentState>;
  /** 仅由用户点击触发，下载并验证完整运行环境 */
  installEnvironment: () => Promise<AlignmentEnvironmentState>;
  /** 中止安装并清理未完成的专用环境 */
  cancelEnvironmentInstall: () => Promise<boolean>;
  /** 卸载专用 Python、依赖、模型和缓存 */
  uninstallEnvironment: () => Promise<AlignmentEnvironmentState>;
  /** 环境维护期间关闭到后台，返回是否已隐藏当前窗口 */
  continueInBackground: () => Promise<boolean>;
  /** 订阅有界的安装进度与环境状态 */
  onEnvironmentStatus: (callback: (state: AlignmentEnvironmentState) => void) => () => void;
}
