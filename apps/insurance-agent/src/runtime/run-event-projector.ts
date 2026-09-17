import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentRunEventDraft } from "./run-registry.js";

/**
 * 把 SDK session 事件投影为对外事件。
 *
 * 只放行稳定、可公开的状态与回答增量：thinking 正文、prompt、文件内容、工具
 * 参数与结果、凭据一律丢弃。对外顺序由 registry 分配的 cursor 决定。
 *
 * `agent.started` 由 registry 在 session 就绪后发出，因此这里忽略 SDK 的
 * `agent_start`，避免同一个事实出现两条事件。
 */

export interface RunEventProjectorOptions {
  readonly now?: () => number;
}

export type RunEventProjector = (
  event: AgentSessionEvent,
) => AgentRunEventDraft | undefined;

/**
 * 创建投影器。
 *
 * 返回的闭包持有 run 内状态（turn 计数、工具起始时间），因此必须每 run 一个实例。
 */
export function createRunEventProjector(
  options: RunEventProjectorOptions = {},
): RunEventProjector {
  const now = options.now ?? (() => Date.now());
  const toolStartedAt = new Map<string, number>();
  let turnIndex = 0;

  return (event) => {
    switch (event.type) {
      case "turn_end":
        turnIndex += 1;
        return { type: "turn.completed", turnIndex };

      case "message_update": {
        // 只有可见回答增量对外；thinking_delta、toolcall_delta 等一律丢弃。
        const update = event.assistantMessageEvent;
        return update.type === "text_delta"
          ? { type: "answer.delta", text: update.delta }
          : undefined;
      }

      case "tool_execution_start":
        toolStartedAt.set(event.toolCallId, now());
        return {
          type: "tool.started",
          toolName: event.toolName,
          toolCallId: event.toolCallId,
        };

      case "tool_execution_end": {
        const startedAt = toolStartedAt.get(event.toolCallId);
        toolStartedAt.delete(event.toolCallId);
        return {
          type: "tool.completed",
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          isError: event.isError,
          durationMs:
            startedAt === undefined ? 0 : Math.max(0, now() - startedAt),
        };
      }

      case "auto_retry_start":
        return {
          type: "retry.started",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
        };

      case "compaction_start":
        return { type: "compaction.started" };

      default:
        return undefined;
    }
  };
}
