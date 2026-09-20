import type {
  ChatApiErrorCode,
  ChatMessageRole,
  ChatMessageStatus,
  ChatSessionTitleSource,
} from "../src/chat/index.js";

/**
 * 编译期穷举表（chat 契约）。
 *
 * 与 `agent-contract-coverage.ts` 同一目的：一旦新增错误码、标题来源、
 * 消息角色或消息状态而没有同步更新，`tsc` 就会失败，避免契约与实现静默漂移。
 */

export const CHAT_API_ERROR_CODE_COVERAGE: Record<ChatApiErrorCode, true> = {
  INVALID_REQUEST: true,
  CONFIG_INVALID: true,
  MODEL_UNAVAILABLE: true,
  SERVICE_NOT_READY: true,
  CAPACITY_EXCEEDED: true,
  RUN_NOT_FOUND: true,
  EVENT_CURSOR_EXPIRED: true,
  INTERNAL_ERROR: true,
  CHAT_SESSION_NOT_FOUND: true,
  CHAT_SESSION_STORE_UNAVAILABLE: true,
};

export const CHAT_SESSION_TITLE_SOURCE_COVERAGE: Record<
  ChatSessionTitleSource,
  true
> = {
  default: true,
  "first-message": true,
  manual: true,
};

export const CHAT_MESSAGE_ROLE_COVERAGE: Record<ChatMessageRole, true> = {
  user: true,
  assistant: true,
};

export const CHAT_MESSAGE_STATUS_COVERAGE: Record<ChatMessageStatus, true> = {
  accepted: true,
  "send-failed": true,
  streaming: true,
  completed: true,
  failed: true,
};
