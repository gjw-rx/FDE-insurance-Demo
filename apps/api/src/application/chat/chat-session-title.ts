import { CHAT_SESSION_TITLE_MAX_LENGTH } from "@renewal/contracts";

/**
 * 会话标题规范化。
 *
 * 归一规则对自动命名与手动重命名一致：去掉首尾空白、把连续空白（含换行）
 * 折叠为单个空格，使标题始终是单行文本。长度按 Unicode 码点计数，避免
 * 中文/emoji 被按 UTF-16 单元截断成半个字符。
 */

/** 把任意输入归一为单行标题文本；归一后为空时返回 null。 */
export function normalizeTitle(input: string): string | null {
  const collapsed = input.replace(/\s+/gu, " ").trim();
  return collapsed.length === 0 ? null : collapsed;
}

/** 按允许的最大码点数确定性截断。 */
export function truncateTitle(input: string): string {
  const codePoints = [...input];
  if (codePoints.length <= CHAT_SESSION_TITLE_MAX_LENGTH) return input;
  return codePoints.slice(0, CHAT_SESSION_TITLE_MAX_LENGTH).join("");
}

/**
 * 由首条用户消息生成会话标题。
 *
 * 消息可以是多行；这里只取归一后的单行文本并按上限截断，不调用模型。
 * 归一后为空时返回 null，由调用方保持默认标题。
 */
export function deriveTitleFromMessage(message: string): string | null {
  const normalized = normalizeTitle(message);
  if (normalized === null) return null;
  return truncateTitle(normalized);
}

/** 校验手动重命名标题；返回归一结果或 null（表示非法输入）。 */
export function validateRenamedTitle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const normalized = normalizeTitle(input);
  if (normalized === null) return null;
  if ([...normalized].length > CHAT_SESSION_TITLE_MAX_LENGTH) return null;
  return normalized;
}
