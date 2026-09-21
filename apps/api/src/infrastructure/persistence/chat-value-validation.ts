import {
  AGENT_RUN_ABORT_REASONS,
  AGENT_RUN_STATUSES,
  AGENT_RUN_TERMINAL_STATUSES,
  AGENT_SERVICE_ERROR_CODES,
  CHAT_MESSAGE_ROLES,
  CHAT_MESSAGE_STATUSES,
  CHAT_SESSION_TITLE_SOURCES,
  type AgentRunAbortReason,
  type AgentRunSnapshot,
  type AgentRunStatus,
  type AgentServiceErrorCode,
  type ChatMessageRole,
  type ChatMessageStatus,
  type ChatSessionTitleSource,
} from "@renewal/contracts";
import { ChatSessionStoreError } from "../../application/chat/chat-session-store-error.js";

/**
 * 受控取值的读写校验。
 *
 * 取值的事实来源是 `@renewal/contracts` 的取值数组；数据库列只是 `VARCHAR`，既不使用
 * `ENUM` 也没有取值校验约束（见 `.agents/rules/database-schema-design.md`）。因此：
 *
 * - **写入方向**：在产生任何数据库副作用之前拒绝契约外取值。非法取值是程序缺陷，
 *   抛出普通错误（对外映射为通用服务错误），而不是写成一次「看起来成功」的写入。
 * - **读取方向**：遇到契约外取值（人工写入或旧版本遗留）时抛出稳定的
 *   `CHAT_SESSION_STORE_UNAVAILABLE`，不把未知取值透传给对外契约。
 *
 * 错误消息只包含字段名，不回显取值本身，避免把库中的内容带进日志或响应。
 */

/** 非终态 run 取值：终态集合的补集，用于重启恢复与终态收敛的更新条件。 */
export const AGENT_RUN_NON_TERMINAL_STATUSES: readonly AgentRunStatus[] =
  AGENT_RUN_STATUSES.filter(
    (status) =>
      !AGENT_RUN_TERMINAL_STATUSES.some((terminal) => terminal === status),
  );

/** 判断 run 状态是否为非终态（终态集合的补集）。 */
export function isNonTerminalRunStatus(value: unknown): boolean {
  return AGENT_RUN_NON_TERMINAL_STATUSES.some((status) => status === value);
}

/**
 * 判断取值是否属于给定的逻辑枚举。
 *
 * 调用方必须显式给出类型参数（例如 `isOneOf<ChatSessionTitleSource>(...)`）：
 * 取值数组是 `readonly` 元组，省略类型参数时推断结果会是 `string`，收窄不到契约联合类型。
 */
function isOneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && values.some((candidate) => candidate === value)
  );
}

/** 读取到契约外取值：返回稳定错误，不透传未知取值。 */
function corruptValue(field: string): ChatSessionStoreError {
  return new ChatSessionStoreError(
    "CHAT_SESSION_STORE_UNAVAILABLE",
    `会话存储中的 ${field} 取值不在契约内`,
  );
}

/** 写入契约外取值：属于程序缺陷，且必须发生在数据库副作用之前。 */
function invalidValue(field: string): Error {
  return new Error(`写入 ${field} 的取值不在契约内`);
}

/** 读取标题来源。 */
export function readTitleSource(value: unknown): ChatSessionTitleSource {
  if (!isOneOf<ChatSessionTitleSource>(CHAT_SESSION_TITLE_SOURCES, value)) {
    throw corruptValue("chat_session.title_source");
  }
  return value;
}

/** 读取消息角色。 */
export function readMessageRole(value: unknown): ChatMessageRole {
  if (!isOneOf<ChatMessageRole>(CHAT_MESSAGE_ROLES, value)) {
    throw corruptValue("chat_message.role");
  }
  return value;
}

/** 读取消息状态。 */
export function readMessageStatus(value: unknown): ChatMessageStatus {
  if (!isOneOf<ChatMessageStatus>(CHAT_MESSAGE_STATUSES, value)) {
    throw corruptValue("chat_message.status");
  }
  return value;
}

/** 读取 run 状态。 */
export function readRunStatus(value: unknown): AgentRunStatus {
  if (!isOneOf<AgentRunStatus>(AGENT_RUN_STATUSES, value)) {
    throw corruptValue("chat_run.status");
  }
  return value;
}

/** 读取 run 中断原因。 */
export function readRunAbortReason(value: unknown): AgentRunAbortReason {
  if (!isOneOf<AgentRunAbortReason>(AGENT_RUN_ABORT_REASONS, value)) {
    throw corruptValue("chat_run.abort_reason");
  }
  return value;
}

/** 读取 Agent 稳定错误码。 */
export function readServiceErrorCode(value: unknown): AgentServiceErrorCode {
  if (!isOneOf<AgentServiceErrorCode>(AGENT_SERVICE_ERROR_CODES, value)) {
    throw corruptValue("chat_run.error_code");
  }
  return value;
}

/** 校验待写入的标题来源。 */
export function assertWritableTitleSource(value: unknown): void {
  if (!isOneOf<ChatSessionTitleSource>(CHAT_SESSION_TITLE_SOURCES, value)) {
    throw invalidValue("chat_session.title_source");
  }
}

/** 校验待写入的消息状态。 */
export function assertWritableMessageStatus(value: unknown): void {
  if (!isOneOf<ChatMessageStatus>(CHAT_MESSAGE_STATUSES, value)) {
    throw invalidValue("chat_message.status");
  }
}

/** 校验待写入的 run 状态。 */
export function assertWritableRunStatus(value: unknown): void {
  if (!isOneOf<AgentRunStatus>(AGENT_RUN_STATUSES, value)) {
    throw invalidValue("chat_run.status");
  }
}

/** 校验待写入的 run 终态。 */
export function assertWritableRunFinishStatus(value: unknown): void {
  if (!isOneOf<AgentRunStatus>(AGENT_RUN_TERMINAL_STATUSES, value)) {
    throw invalidValue("chat_run.status（终态）");
  }
}

/**
 * 解析库中的 Agent 快照。
 *
 * 快照是外部服务返回结构的副本，落库后可能与当前契约不一致，因此逐字段校验；
 * 缺少 `finishedAt`、`abortReason`、`errorCode` 是正常情况（非终态或非对应状态）。
 */
export function parseRunSnapshot(value: unknown): AgentRunSnapshot | undefined {
  if (value === null || value === undefined) return undefined;

  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw corruptValue("chat_run.snapshot_json");
    }
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw corruptValue("chat_run.snapshot_json");
  }

  const record = parsed as Record<string, unknown>;
  const agentName = record["agentName"];
  const sessionId = record["sessionId"];
  const runId = record["runId"];
  const createdAt = record["createdAt"];
  if (
    typeof agentName !== "string" ||
    typeof sessionId !== "string" ||
    typeof runId !== "string" ||
    typeof createdAt !== "string"
  ) {
    throw corruptValue("chat_run.snapshot_json");
  }

  const status = readRunStatus(record["status"]);
  const snapshot: {
    agentName: string;
    sessionId: string;
    runId: string;
    status: AgentRunStatus;
    createdAt: string;
    finishedAt?: string;
    abortReason?: AgentRunAbortReason;
    errorCode?: AgentServiceErrorCode;
  } = { agentName, sessionId, runId, status, createdAt };

  const finishedAt = record["finishedAt"];
  if (finishedAt !== undefined) {
    if (typeof finishedAt !== "string") {
      throw corruptValue("chat_run.snapshot_json.finishedAt");
    }
    snapshot.finishedAt = finishedAt;
  }

  const abortReason = record["abortReason"];
  if (abortReason !== undefined) {
    snapshot.abortReason = readRunAbortReason(abortReason);
  }

  const errorCode = record["errorCode"];
  if (errorCode !== undefined) {
    snapshot.errorCode = readServiceErrorCode(errorCode);
  }

  return snapshot;
}
