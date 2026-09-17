import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createRunEventProjector } from "../../src/runtime/run-event-projector.js";

/** 构造任意 SDK 事件替身，避免逐字段声明。 */
function sdkEvent(value: Record<string, unknown>): AgentSessionEvent {
  return value as unknown as AgentSessionEvent;
}

/** 构造文本增量 SDK 事件替身。 */
function textDelta(delta: string): AgentSessionEvent {
  return sdkEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta },
  });
}

describe("事件投影", () => {
  it("只放行可见回答增量", () => {
    const project = createRunEventProjector();

    expect(project(textDelta("你好"))).toEqual({
      type: "answer.delta",
      text: "你好",
    });
  });

  it("丢弃 thinking 正文与工具参数/结果", () => {
    const project = createRunEventProjector();

    const thinking = project(
      sdkEvent({
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: "CANARY-THINKING",
        },
      }),
    );
    const toolStart = project(
      sdkEvent({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "read",
        args: { path: "CANARY-ARGS" },
      }),
    );
    const toolEnd = project(
      sdkEvent({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "read",
        result: { content: "CANARY-RESULT" },
        isError: false,
      }),
    );

    expect(thinking).toBeUndefined();
    for (const payload of [toolStart, toolEnd]) {
      expect(JSON.stringify(payload)).not.toContain("CANARY");
    }
  });

  it("把工具执行映射为脱敏的 started/completed 事件并计算耗时", () => {
    let currentTime = 1_000;
    const project = createRunEventProjector({ now: () => currentTime });

    const started = project(
      sdkEvent({
        type: "tool_execution_start",
        toolCallId: "call-9",
        toolName: "grep",
        args: { pattern: "x" },
      }),
    );
    currentTime = 1_250;
    const completed = project(
      sdkEvent({
        type: "tool_execution_end",
        toolCallId: "call-9",
        toolName: "grep",
        result: { content: "命中" },
        isError: true,
      }),
    );

    expect(started).toEqual({
      type: "tool.started",
      toolName: "grep",
      toolCallId: "call-9",
    });
    expect(completed).toEqual({
      type: "tool.completed",
      toolName: "grep",
      toolCallId: "call-9",
      isError: true,
      durationMs: 250,
    });
  });

  it("映射 turn、retry 与 compaction 生命周期", () => {
    const project = createRunEventProjector();

    expect(project(sdkEvent({ type: "turn_end" }))).toEqual({
      type: "turn.completed",
      turnIndex: 1,
    });
    expect(project(sdkEvent({ type: "turn_end" }))).toEqual({
      type: "turn.completed",
      turnIndex: 2,
    });
    expect(
      project(
        sdkEvent({ type: "auto_retry_start", attempt: 2, maxAttempts: 3 }),
      ),
    ).toEqual({
      type: "retry.started",
      attempt: 2,
      maxAttempts: 3,
    });
    expect(
      project(sdkEvent({ type: "compaction_start", reason: "threshold" })),
    ).toEqual({
      type: "compaction.started",
    });
  });

  it("忽略由 registry 负责的 agent_start 与其他内部事件", () => {
    const project = createRunEventProjector();

    for (const type of [
      "agent_start",
      "agent_end",
      "agent_settled",
      "message_start",
      "message_end",
      "tool_execution_update",
      "entry_appended",
      "queue_update",
    ]) {
      expect(
        project(sdkEvent({ type })),
        `${type} 不应对外暴露`,
      ).toBeUndefined();
    }
  });
});
