import type { LocaleCode } from "./settings";
import type { AiTokenUsage } from "./ai";

/** 桌面角色区域的边长，单位为 DIP */
export const COMPANION_AVATAR_SIZE = 80;

/** 桌面回复气泡的自动隐藏时长，单位为秒 */
export const COMPANION_REPLY_BUBBLE_SECONDS = { min: 3, max: 30, default: 8 } as const;

export interface CompanionSettings {
  enabled: boolean;
  showAvatar: boolean;
  replyBubble: boolean;
  replyBubbleSeconds: number;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  proactive: boolean;
  danmaku: boolean;
  danmakuSeconds: number;
  danmakuLanes: number;
  x: number | null;
  y: number | null;
}

export interface CompanionMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  proactive: boolean;
  usage?: AiTokenUsage;
}

export interface CompanionState extends Pick<
  CompanionSettings,
  "replyBubble" | "replyBubbleSeconds"
> {
  messages: CompanionMessage[];
  pending: boolean;
  draft: string;
  error: string | null;
  track: { title: string; artists: string; cover?: string } | null;
  locale: LocaleCode;
}

/** 主窗口已解析的外观，不含图片数据或曲目信息 */
export interface CompanionTheme {
  theme: string;
  material: string;
  motion: string;
  tier: string;
  appearance: string;
  dark: boolean;
  reducedMotion: boolean;
  variables: Record<string, string>;
}

/** 对话面板或回复气泡的原生内容区和角色偏移，单位为 DIP */
export interface CompanionPlacement {
  width: number;
  height: number;
  avatarX: number;
  avatarY: number;
  side: "top" | "bottom";
  align: "start" | "center" | "end";
}

/** 固定外框尺寸及角色偏移，用于避免点击展开收起时因改窗导致闪烁 */
export interface CompanionFrame {
  width: number;
  height: number;
  avatarX: number;
  avatarY: number;
}

/** 提前告知两种展开布局，使页面能按实际视口切换而不挪动角色 */
export interface CompanionLayout extends CompanionPlacement {
  bubble: CompanionPlacement;
  frame?: CompanionFrame;
}

export type CompanionSurface = "chat" | "bubble";

export interface CompanionApi {
  getLayout: () => Promise<CompanionLayout>;
  onLayout: (callback: (layout: CompanionLayout) => void) => () => void;
  beginDrag: () => void;
  endDrag: (cancelled: boolean) => Promise<boolean>;
  moveBy: (dx: number, dy: number) => void;
  setTheme: (theme: CompanionTheme) => void;
  getTheme: () => Promise<CompanionTheme | null>;
  onTheme: (callback: (theme: CompanionTheme) => void) => () => void;
  getState: () => Promise<CompanionState>;
  onState: (callback: (state: CompanionState) => void) => () => void;
  onDraft: (callback: (text: string) => void) => () => void;
  onBeat: (callback: (level: number) => void) => () => void;
  onConfigChange: (callback: (config: CompanionSettings) => void) => () => void;
  onDanmaku: (callback: (message: CompanionMessage) => void) => () => void;
  send: (text: string) => Promise<void>;
  setTyping: (typing: boolean) => void;
  /** 聊天收起时立即取消请求，气泡收起时仅等待动画 */
  setExpanded: (expanded: boolean, surface?: CompanionSurface) => number;
  /** 仅收缩对应切换序号的窗口 */
  finishCollapse: (revision: number) => void;
  setIgnoreMouse: (ignore: boolean) => void;
}
