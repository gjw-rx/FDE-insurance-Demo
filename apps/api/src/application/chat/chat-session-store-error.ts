import type { ChatSessionErrorCode } from "@renewal/contracts";

/**
 * 会话层可对外表达的稳定错误码。
 *
 * `INVALID_REQUEST` 属于 HTTP 校验层，不由仓储抛出；仓储只表达「不存在」与
 * 「存储不可用」，这样上层无需解析实现细节或原始异常消息。
 */
export type ChatSessionStoreErrorCode = Extract<
  ChatSessionErrorCode,
  "CHAT_SESSION_NOT_FOUND" | "CHAT_SESSION_STORE_UNAVAILABLE"
>;

/** 仓储错误。消息只用于内部诊断，不直接返回给浏览器。 */
export class ChatSessionStoreError extends Error {
  readonly code: ChatSessionStoreErrorCode;

  constructor(code: ChatSessionStoreErrorCode, message: string) {
    super(message);
    this.name = "ChatSessionStoreError";
    this.code = code;
  }
}
