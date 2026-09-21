import {
  AGENT_RUN_TERMINAL_STATUSES,
  AGENT_SERVICE_ERROR_CODES,
} from "../src/agent/index.js";
import type {
  AgentRunEventType,
  AgentRunTerminalEventType,
} from "../src/agent/index.js";
import { buildCoverage } from "./coverage.js";

/**
 * 编译期穷举表。
 *
 * 这些表用 `Record<联合类型, true>` 形式声明：一旦新增终态、事件类型或错误码
 * 而没有同步更新，`tsc` 就会失败，避免契约与实现静默漂移。终态表与错误码表由
 * `src/agent` 的取值数组派生；事件类型没有运行时数组，仍保留手写表。
 */

export const TERMINAL_RUN_STATUS_COVERAGE = buildCoverage(
  AGENT_RUN_TERMINAL_STATUSES,
);

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

export const SERVICE_ERROR_CODE_COVERAGE = buildCoverage(
  AGENT_SERVICE_ERROR_CODES,
);
