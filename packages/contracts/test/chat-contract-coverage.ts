import {
  CHAT_MESSAGE_ROLES,
  CHAT_MESSAGE_STATUSES,
  CHAT_SESSION_TITLE_SOURCES,
} from "../src/chat/index.js";
import type { ChatApiErrorCode } from "../src/chat/index.js";
import { buildCoverage } from "./coverage.js";

/**
 * 编译期穷举表（chat 契约）。
 *
 * 与 `agent-contract-coverage.ts` 同一目的：一旦新增错误码或受控取值而没有同步
 * 更新，`tsc` 就会失败，避免契约与实现静默漂移。受控取值表由 `src/chat` 的取值
 * 数组派生，因此取值字面量只存在一处；错误码没有运行时数组，仍保留手写表。
 */

/** 错误码穷举表（无运行时数组，手写以做完整性检查）。 */
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

export const CHAT_SESSION_TITLE_SOURCE_COVERAGE = buildCoverage(
  CHAT_SESSION_TITLE_SOURCES,
);

export const CHAT_MESSAGE_ROLE_COVERAGE = buildCoverage(CHAT_MESSAGE_ROLES);

export const CHAT_MESSAGE_STATUS_COVERAGE = buildCoverage(
  CHAT_MESSAGE_STATUSES,
);
