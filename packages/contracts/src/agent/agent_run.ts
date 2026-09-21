import type { AgentServiceErrorCode } from "./agent_errors.js";

/**
 * run 生命周期状态。
 *
 * 逻辑枚举的运行时唯一来源：数据库存字符串取值但不加约束，合法性由应用层按本数组
 * 校验。`completed`、`failed`、`aborted` 是终态，一个 run 只能进入其中一个。
 */
export const AGENT_RUN_STATUSES = [
 "accepted",
 "running",
 "completed",
 "failed",
 "aborted",
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** 终态取值，从 `AGENT_RUN_STATUSES` 收窄以保证与状态定义一致。 */
export const AGENT_RUN_TERMINAL_STATUSES = [
 "completed",
 "failed",
 "aborted",
] as const satisfies readonly AgentRunStatus[];

/** 终态集合，从终态取值数组派生以保证与状态定义一致。 */
export type AgentRunTerminalStatus =
 (typeof AGENT_RUN_TERMINAL_STATUSES)[number];

/** 停止原因取值；逻辑枚举的运行时唯一来源。 */
export const AGENT_RUN_ABORT_REASONS = ["requested", "timeout"] as const;

/** 停止原因：调用方请求，或服务侧超时。 */
export type AgentRunAbortReason = (typeof AGENT_RUN_ABORT_REASONS)[number];

/** 创建 run 的请求体。项目 ID 由业务系统生成，与 Pi 内部 session ID 分离。 */
export interface AgentRunCreateRequest {
 /** 业务会话标识，用于关联同一次连续交互。 */
 readonly sessionId: string;
 /** 业务 run 标识，服务以此保证幂等。 */
 readonly runId: string;
 /** 用户消息正文。 */
 readonly message: string;
}

/** run 快照。同一个 runId 重复提交返回同一快照，不重复执行 Agent loop。 */
export interface AgentRunSnapshot {
 readonly agentName: string;
 readonly sessionId: string;
 readonly runId: string;
 readonly status: AgentRunStatus;
 /** ISO 8601 时间戳。 */
 readonly createdAt: string;
 /** 进入终态时的 ISO 8601 时间戳。 */
 readonly finishedAt?: string;
 /** 仅当状态为 aborted 时存在。 */
 readonly abortReason?: AgentRunAbortReason;
 /** 仅当状态为 failed 时存在。 */
 readonly errorCode?: AgentServiceErrorCode;
}

/** 停止 run 的响应：返回停止后的快照，重复调用保持幂等。 */
export interface AgentRunAbortResponse {
 readonly snapshot: AgentRunSnapshot;
}
