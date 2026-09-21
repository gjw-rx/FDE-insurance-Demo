import type { AgentServiceErrorCode } from "./agent_errors.js";
import type { AgentRunAbortReason } from "./agent_run.js";

/**
 * 对外 SSE 事件。
 *
 * 事件只暴露稳定、可公开的状态与回答增量；thinking 正文、prompt、文件内容、
 * 凭据、工具原始参数与结果都不会出现在事件里。
 */
export interface AgentEventBase {
    readonly agentName: string;
    readonly sessionId: string;
    readonly runId: string;
    /** 每个 run 内单调递增，从 1 开始；用于断线续接。 */
    readonly cursor: number;
    /** ISO 8601 时间戳。 */
    readonly at: string;
}

export type AgentRunEvent =
    | (AgentEventBase & { readonly type: "run.accepted" })
    | (AgentEventBase & { readonly type: "agent.started" })
    | (AgentEventBase & {
          readonly type: "answer.delta";
          readonly text: string;
      })
    | (AgentEventBase & {
          readonly type: "turn.completed";
          readonly turnIndex: number;
      })
    | (AgentEventBase & {
          readonly type: "tool.started";
          readonly toolName: string;
          readonly toolCallId: string;
      })
    | (AgentEventBase & {
          readonly type: "tool.completed";
          readonly toolName: string;
          readonly toolCallId: string;
          readonly isError: boolean;
          readonly durationMs: number;
      })
    | (AgentEventBase & {
          readonly type: "retry.started";
          readonly attempt: number;
          readonly maxAttempts: number;
      })
    | (AgentEventBase & { readonly type: "compaction.started" })
    | (AgentEventBase & { readonly type: "run.completed" })
    | (AgentEventBase & {
          readonly type: "run.failed";
          readonly errorCode: AgentServiceErrorCode;
      })
    | (AgentEventBase & {
          readonly type: "run.aborted";
          readonly reason: AgentRunAbortReason;
      });

export type AgentRunEventType = AgentRunEvent["type"];

/** 终态事件类型，一个 run 只会发出其中一个。 */
export type AgentRunTerminalEventType = Extract<
    AgentRunEventType,
    "run.completed" | "run.failed" | "run.aborted"
>;
