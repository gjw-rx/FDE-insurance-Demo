import { ApiConfigError } from "./config-error.js";

/**
 * 环境变量读取工具。
 *
 * 只做「字符串 → 强类型」的确定性转换：缺失或空白一律使用调用方给出的默认值，
 * 非法值直接拒绝。错误消息只包含字段名与规则，绝不回显原始值，避免 secret
 * 通过启动失败日志或测试产物泄露。
 */

/** 解析正整数字段；缺失或空白使用默认值，非法即拒绝。 */
export function readPositiveInteger(
  name: string,
  raw: string | undefined,
  defaultValue: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new ApiConfigError(
      "config-invalid",
      name,
      `${name} 必须是 1-${max} 之间的整数`,
    );
  }
  return value;
}

/** 解析布尔开关；只接受 true/false/1/0，缺失或空白视为 false。 */
export function readBooleanFlag(
  name: string,
  raw: string | undefined,
): boolean {
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (value === "" || value === "false" || value === "0") return false;
  if (value === "true" || value === "1") return true;
  throw new ApiConfigError(
    "config-invalid",
    name,
    `${name} 只接受 true、false、1 或 0`,
  );
}
