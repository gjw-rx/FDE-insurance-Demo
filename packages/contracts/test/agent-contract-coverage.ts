import type {
  AgentRunEventType,
  AgentRunTerminalEventType,
  AgentRunTerminalStatus,
  AgentServiceErrorCode,
} from "../src/agent/index.js";

/**
 * 编译期穷举表。
 *
 * 这些表用 `Record<联合类型, true>` 形式声明：一旦新增终态、事件类型或错误码
 * 而没有同步更新，`tsc` 就会失败，避免契约与实现静默漂移。
 */

export const TERMINAL_RUN_STATUS_COVERAGE: Record<
  AgentRunTerminalStatus,
  true
> = {
  completed: true,
  failed: true,
  aborted: true,
};

export const RUN_EVENT_TYPE_COVERAGE: Record<AgentRunEventType, true> = {
  "run.accepted": true,
  "agent.started": true,
  "answer.delta": true,
  "turn.completed": true,
  "tool.started": true,
  "tool.completed": true,
  "retry.started": true,
  "compaction.started": true,
  "run.completed": true,
  "run.failed": true,
  "run.aborted": true,
};

export const TERMINAL_RUN_EVENT_TYPE_COVERAGE: Record<
  AgentRunTerminalEventType,
  true
> = {
  "run.completed": true,
  "run.failed": true,
  "run.aborted": true,
};

export const SERVICE_ERROR_CODE_COVERAGE: Record<AgentServiceErrorCode, true> =
  {
    INVALID_REQUEST: true,
    CONFIG_INVALID: true,
    MODEL_UNAVAILABLE: true,
    SERVICE_NOT_READY: true,
    CAPACITY_EXCEEDED: true,
    RUN_NOT_FOUND: true,
    EVENT_CURSOR_EXPIRED: true,
    INTERNAL_ERROR: true,
  };
