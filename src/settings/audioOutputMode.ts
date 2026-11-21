import type { AudioOutputMode } from "@shared/types/settings";
import type { SettingItem } from "@/types/settings-schema";
import { isWin } from "@/utils/config";

export const AUDIO_OUTPUT_MODE_CONFIG_KEY = "player.audioOutputMode";

const options = [
  { value: "shared", labelKey: "settings.audioOutputMode.shared" },
  { value: "exclusive", labelKey: "settings.audioOutputMode.exclusive" },
  { value: "bit-perfect", labelKey: "settings.audioOutputMode.direct" },
] satisfies { value: AudioOutputMode; labelKey: string }[];

/** 设置页和全屏快捷菜单共用的输出模式定义 */
export const audioOutputModeSetting = {
  key: "audioOutputMode",
  type: "select",
  binding: { store: "settings", path: `system.${AUDIO_OUTPUT_MODE_CONFIG_KEY}` },
  options,
  defaultValue: "shared",
  confirm: {
    when: (next) => next === "exclusive" || next === "bit-perfect",
    titleKey: "settings.confirm.exclusiveModeTitle",
    contentKey: "settings.confirm.exclusiveModeContent",
    type: "warning",
  },
  visible: () => isWin,
} satisfies SettingItem;
