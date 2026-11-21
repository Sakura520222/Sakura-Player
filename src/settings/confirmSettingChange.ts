import { dialog } from "@/composables/useDialog";
import type { SettingConfirm } from "@/types/settings-schema";

/**
 * 按设置项规则打开确认弹窗
 * @param config - 设置项的确认规则
 * @param next - 本次提交的值
 * @param t - 界面翻译函数
 * @returns 需要确认时返回用户选择
 */
export function confirmSettingChange(
  config: SettingConfirm | undefined,
  next: unknown,
  t: (key: string) => string,
): Promise<boolean> | undefined {
  if (!config || (config.when && !config.when(next))) return;
  return dialog.confirm({
    title: config.titleKey ? t(config.titleKey) : undefined,
    content: t(config.contentKey),
    type: config.type ?? "warning",
    confirmText: config.confirmTextKey ? t(config.confirmTextKey) : undefined,
    cancelText: config.cancelTextKey ? t(config.cancelTextKey) : undefined,
  });
}
