import path from "node:path";
import { automixDirs } from "@main/utils/paths";
import {
  getAutoMixComponentStatus,
  installAutoMixComponents,
  cancelAutoMixDownload,
} from "../automix/components";

/** 获取 AutoMix 共用 ONNX 运行库的固定路径 */
export const acousticRuntimePath = (): string =>
  path.join(
    automixDirs.runtime,
    process.platform === "win32"
      ? "onnxruntime.dll"
      : process.platform === "darwin"
        ? "libonnxruntime.dylib"
        : "libonnxruntime.so",
  );

/**
 * 显式下载声学模型时仅准备共用运行库，不下载节拍或分离模型
 * @param signal - 本次模型安装的取消信号
 */
export const ensureAcousticRuntime = async (signal: AbortSignal): Promise<void> => {
  signal.throwIfAborted();
  const state = await getAutoMixComponentStatus();
  if (state.models.find((model) => model.id === "runtime")?.state === "ready") return;
  if (state.models.some((model) => model.state === "downloading"))
    throw new Error("请等待 AutoMix 组件下载完成后重试");
  signal.throwIfAborted();
  signal.addEventListener("abort", cancelAutoMixDownload, { once: true });
  try {
    const next = await installAutoMixComponents("runtime");
    signal.throwIfAborted();
    const runtime = next.models.find((model) => model.id === "runtime");
    if (runtime?.state !== "ready") throw new Error(runtime?.error ?? "ONNX 运行库未就绪");
  } finally {
    signal.removeEventListener("abort", cancelAutoMixDownload);
  }
};
