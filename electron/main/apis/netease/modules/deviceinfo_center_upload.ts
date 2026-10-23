import { hostname, userInfo } from "node:os";
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

/**
 * 生成与官方客户端一致的设备名称
 * @returns 用户名与计算机名，用户名为空时只使用计算机名
 */
const defaultDeviceName = (): string => {
  const user = userInfo().username.trim();
  const host = hostname();
  return user ? `${user} 的 ${host}` : host;
};

/**
 * 登录后更新设备管理中展示的名称
 * @param query - 可选设备名与请求配置，缺省名称由当前主机生成
 * @param request - 网易云请求执行器
 * @returns 设备信息上报响应
 */
const deviceinfoCenterUpload: NeteaseModule = async (query, request) => {
  const deviceName = String(query.deviceName ?? "").trim() || defaultDeviceName();
  return request("/api/deviceinfo/center/upload", { deviceName }, createOption(query, "eapi"));
};

export default deviceinfoCenterUpload;
