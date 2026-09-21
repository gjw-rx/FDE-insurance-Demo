import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { AgentRunEvent, AgentRunSnapshot } from "@renewal/contracts/agent";
import {
  buildConfig,
  createRecordingLogger,
  createRegistryHarness as createHarness,
  createTestClock,
  hanging,
} from "../support/agent_fixtures.js";
import {
  AgentRunRegistry,
  type AgentRunAbortOutcome,
  type AgentRunCreateOutcome,
} from "../../src/runtime/run_registry.js";
import { createRunEventProjector } from "../../src/runtime/run_event_projector.js";

/** 轮询等待条件成立，超时即失败。 */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待条件超时");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** 读取 registry 中某 run 的全部缓冲事件。 */
function eventsOf(
  registry: AgentRunRegistry,
  runId: string,
): readonly AgentRunEvent[] {
  return registry.eventsSince(runId, 0)?.events ?? [];
}

/** 窄化联合类型：被拒绝的 run 没有快照。 */
function snapshotOf(outcome: AgentRunCreateOutcome): AgentRunSnapshot {
  if (outcome.kind === "rejected")
    throw new Error(`run 被拒绝：${outcome.code}`);
  return outcome.snapshot;
}

/** 窄化联合类型：not-found 没有快照。 */
function snapshotOfAbort(outcome: AgentRunAbortOutcome): AgentRunSnapshot {
  if (outcome.kind === "not-found") throw new Error("run 不存在");
  return outcome.snapshot;
}

/** 过滤出终态事件，用于断言单一终态。 */
function terminalEvents(events: readonly AgentRunEvent[]): AgentRunEvent[] {
  return events.filter(
    (event) =>
      event.type === "run.completed" ||
      event.type === "run.failed" ||
      event.type === "run.aborted",
  );
}

describe("run 创建与并发控制", () => {
  it("接受 run 并在完成后收敛到 completed", async () => {
    const harness = createHarness();

    const outcome = await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "你好",
    });

    expect(outcome.kind).toBe("accepted");
    expect(snapshotOf(outcome)).toMatchObject({
      agentName: "insurance-agent",
      sessionId: "session-1",
      runId: "run-1",
      status: "accepted",
    });

    await waitUntil(() => harness.registry.isTerminal("run-1"));

    const snapshot = harness.registry.getSnapshot("run-1");
    expect(snapshot?.status).toBe("completed");
    expect(snapshot?.finishedAt).toBeDefined();
    expect(harness.registry.activeRuns).toBe(0);
    expect(harness.sessions[0]?.disposed).toBe(true);
  });

  it("同一 runId 重复提交不启动第二个 Agent loop", async () => {
    const harness = createHarness({ promptImpl: hanging });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "第一次",
    });
    await waitUntil(
      () => harness.registry.getSnapshot("run-1")?.status === "running",
    );

    const again = await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "第二次",
    });

    expect(again.kind).toBe("existing");
    expect(snapshotOf(again).status).toBe("running");
    expect(harness.sessions).toHaveLength(1);
  });

  it("达到并发上限时返回可重试的容量错误且不影响现有 run", async () => {
    const harness = createHarness({
      runtime: { maxConcurrentRuns: 1 },
      promptImpl: hanging,
    });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "第一个",
    });
    await waitUntil(
      () => harness.registry.getSnapshot("run-1")?.status === "running",
    );

    const rejected = await harness.registry.create({
      sessionId: "session-1",
      runId: "run-2",
      message: "第二个",
    });

    expect(rejected).toMatchObject({
      kind: "rejected",
      code: "CAPACITY_EXCEEDED",
      retryable: true,
    });
    expect(harness.registry.getStatus("run-1")).toBe("running");
    expect(harness.registry.getSnapshot("run-2")).toBeUndefined();
  });
});

describe("单一终态收敛", () => {
  it("超过 deadline 的 run 收敛为 aborted(timeout)", async () => {
    const harness = createHarness({ promptImpl: hanging });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "慢请求",
    });
    await waitUntil(
      () => harness.registry.getSnapshot("run-1")?.status === "running",
    );

    harness.clock.fireTimeouts();
    await waitUntil(() => harness.registry.isTerminal("run-1"));

    const snapshot = harness.registry.getSnapshot("run-1");
    expect(snapshot?.status).toBe("aborted");
    expect(snapshot?.abortReason).toBe("timeout");
    expect(terminalEvents(eventsOf(harness.registry, "run-1"))).toHaveLength(1);
  });

  it("停止活动 run 只产生一个 aborted 终态，重复停止保持幂等", async () => {
    const harness = createHarness({ promptImpl: hanging });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "长任务",
    });
    await waitUntil(
      () => harness.registry.getSnapshot("run-1")?.status === "running",
    );

    const aborted = await harness.registry.abort("run-1");
    expect(aborted.kind).toBe("aborted");
    const abortedSnapshot = snapshotOfAbort(aborted);
    expect(abortedSnapshot.status).toBe("aborted");
    expect(abortedSnapshot.abortReason).toBe("requested");

    const again = await harness.registry.abort("run-1");
    expect(again.kind).toBe("already-finished");
    expect(snapshotOfAbort(again)).toEqual(abortedSnapshot);
    expect(terminalEvents(eventsOf(harness.registry, "run-1"))).toHaveLength(1);
    expect(harness.sessions[0]?.disposed).toBe(true);
  });

  it("停止不存在的 run 返回 not-found", async () => {
    const harness = createHarness();
    expect((await harness.registry.abort("missing")).kind).toBe("not-found");
  });

  it("abort 与正常完成竞争时仍只有一个终态", async () => {
    let finishPrompt: (() => void) | undefined;
    const harness = createHarness({
      promptImpl: () =>
        new Promise<void>((resolve) => {
          finishPrompt = resolve;
        }),
    });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "竞态",
    });
    await waitUntil(
      () => harness.registry.getSnapshot("run-1")?.status === "running",
    );

    const aborting = harness.registry.abort("run-1");
    finishPrompt?.();
    await aborting;
    await waitUntil(() => harness.registry.activeRuns === 0);

    const events = eventsOf(harness.registry, "run-1");
    expect(terminalEvents(events)).toHaveLength(1);
    expect(harness.registry.getSnapshot("run-1")?.status).toBe("aborted");
  });

  it("Agent 执行失败时收敛为 failed 且错误码稳定", async () => {
    const harness = createHarness({
      promptImpl: async () => {
        throw new Error("provider 连接失败，包含敏感细节");
      },
    });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "会失败",
    });
    await waitUntil(() => harness.registry.isTerminal("run-1"));

    const snapshot = harness.registry.getSnapshot("run-1");
    expect(snapshot?.status).toBe("failed");
    expect(snapshot?.errorCode).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(eventsOf(harness.registry, "run-1"))).not.toContain(
      "敏感细节",
    );
  });

  it("session 创建失败时收敛为 failed", async () => {
    const registry = new AgentRunRegistry({
      config: buildConfig(),
      clock: createTestClock().clock,
      createSession: async () => {
        throw new Error("SDK 初始化失败");
      },
    });

    await registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "无法启动",
    });
    await waitUntil(() => registry.isTerminal("run-1"));

    expect(registry.getSnapshot("run-1")?.status).toBe("failed");
  });

  it("stopAll 中断所有活动 run 并拒绝新 run", async () => {
    const harness = createHarness({ promptImpl: hanging });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "a",
    });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-2",
      message: "b",
    });
    await waitUntil(() => harness.registry.activeRuns === 2);

    await harness.registry.stopAll();

    expect(harness.registry.getSnapshot("run-1")?.status).toBe("aborted");
    expect(harness.registry.getSnapshot("run-2")?.status).toBe("aborted");
    expect(harness.registry.activeRuns).toBe(0);

    const rejected = await harness.registry.create({
      sessionId: "session-1",
      runId: "run-3",
      message: "c",
    });
    expect(rejected).toMatchObject({
      kind: "rejected",
      code: "SERVICE_NOT_READY",
    });
  });

  it("stopAll 等待活动 runtime 完成 dispose", async () => {
    let finishDispose: (() => void) | undefined;
    const registry = new AgentRunRegistry({
      config: buildConfig(),
      createSession: async () => ({
        piSessionId: "pi-session-1",
        subscribe: () => () => undefined,
        prompt: hanging,
        abort: async () => undefined,
        dispose: () =>
          new Promise<void>((resolve) => {
            finishDispose = resolve;
          }),
      }),
    });
    await registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "a",
    });
    await waitUntil(() => registry.getStatus("run-1") === "running");

    let stopped = false;
    const stopping = registry.stopAll().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishDispose?.();
    await stopping;
    expect(stopped).toBe(true);
  });
});

describe("事件序号与投影", () => {
  it("投影 SDK 事件并分配单调 cursor，补齐 agent/session/run 标识", async () => {
    const harness = createHarness({
      promptImpl: hanging,
      createProjector: () => (event) =>
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
          ? { type: "answer.delta", text: event.assistantMessageEvent.delta }
          : undefined,
    });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "你好",
    });
    await waitUntil(() => harness.sessions.length === 1);

    harness.sessions[0]?.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "你好" },
    } as unknown as AgentSessionEvent);

    const events = eventsOf(harness.registry, "run-1");
    expect(events.map((event) => event.cursor)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.type)).toEqual([
      "run.accepted",
      "agent.started",
      "answer.delta",
    ]);
    expect(events[2]).toMatchObject({
      type: "answer.delta",
      text: "你好",
      agentName: "insurance-agent",
      sessionId: "session-1",
      runId: "run-1",
    });
  });

  it("turnIndex 与工具计时不会跨 run 串扰（每 run 独立投影器）", async () => {
    const harness = createHarness({
      promptImpl: hanging,
      createProjector: () => createRunEventProjector(),
    });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "第一个 run",
    });
    await waitUntil(() => harness.sessions.length === 1);

    // run-1 产生两个 turn 与一次工具调用。
    harness.sessions[0]?.emit({
      type: "turn_end",
    } as unknown as AgentSessionEvent);
    harness.sessions[0]?.emit({
      type: "turn_end",
    } as unknown as AgentSessionEvent);
    harness.sessions[0]?.emit({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "read",
    } as unknown as AgentSessionEvent);
    await harness.registry.abort("run-1");

    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-2",
      message: "第二个 run",
    });
    await waitUntil(
      () => harness.registry.getSnapshot("run-2")?.status === "running",
    );

    // run-2 的第一个 turn 应从 1 重新计数，不受 run-1 的影响。
    harness.sessions[1]?.emit({
      type: "turn_end",
    } as unknown as AgentSessionEvent);

    const events = eventsOf(harness.registry, "run-2");
    const firstTurn = events.find((event) => event.type === "turn.completed");
    expect(firstTurn).toMatchObject({ type: "turn.completed", turnIndex: 1 });
  });

  it("未投影的 SDK 事件不会出现在对外事件流中", async () => {
    const harness = createHarness({ promptImpl: hanging });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "你好",
    });
    await waitUntil(() => harness.sessions.length === 1);

    harness.sessions[0]?.emit({
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "内部推理" },
    } as unknown as AgentSessionEvent);

    expect(JSON.stringify(eventsOf(harness.registry, "run-1"))).not.toContain(
      "内部推理",
    );
  });

  it("单个 subscriber 抛错不会阻断其他订阅者或 run 收敛", async () => {
    const harness = createHarness({ promptImpl: hanging });
    const received: AgentRunEvent[] = [];
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "你好",
    });
    await waitUntil(() => harness.sessions.length === 1);

    harness.registry.subscribe("run-1", () => {
      throw new Error("transport closed");
    });
    harness.registry.subscribe("run-1", (event) => received.push(event));

    await harness.registry.abort("run-1");

    expect(received.map((event) => event.type)).toEqual(["run.aborted"]);
    expect(harness.registry.getStatus("run-1")).toBe("aborted");
    expect(harness.sessions[0]?.disposed).toBe(true);
  });
});

describe("事件保留与缓冲上限", () => {
  it("终态 run 在保留期结束后被清理", async () => {
    const harness = createHarness({ runtime: { eventRetentionMs: 1_000 } });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "你好",
    });
    await waitUntil(() => harness.registry.isTerminal("run-1"));
    expect(harness.registry.getSnapshot("run-1")?.status).toBe("completed");

    harness.clock.fireTimeouts();

    expect(harness.registry.getSnapshot("run-1")).toBeUndefined();
    expect(harness.registry.eventsSince("run-1", 0)).toBeUndefined();
  });

  it("事件数超过上限时只保留最近的事件并暴露最早可用 cursor", async () => {
    const harness = createHarness({
      runtime: { maxEventsPerRun: 16 },
      promptImpl: hanging,
      createProjector: () => createRunEventProjector(),
    });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "你好",
    });
    await waitUntil(() => harness.sessions.length === 1);

    for (let index = 0; index < 30; index += 1) {
      harness.sessions[0]?.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: `第${index}段` },
      } as unknown as AgentSessionEvent);
    }

    const view = harness.registry.eventsSince("run-1", 0);
    expect(view?.events).toHaveLength(16);
    expect(view?.events.at(-1)?.cursor).toBe(32);
    expect(view?.earliestCursor).toBe(view?.events[0]?.cursor);

    const after = harness.registry.eventsSince("run-1", 30);
    expect(after?.events.map((event) => event.cursor)).toEqual([31, 32]);
  });
});

describe("运行日志", () => {
  it("记录 run 生命周期与失败原因，且不泄漏消息正文", async () => {
    const logger = createRecordingLogger();
    const harness = createHarness({
      logger,
      promptImpl: async () => {
        throw new Error("provider 连接被拒绝");
      },
    });

    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "绝密案件信息",
    });
    await waitUntil(() => harness.registry.isTerminal("run-1"));

    expect(logger.entries.map((entry) => entry.event)).toEqual([
      "run.accepted",
      "run.prompt-failed",
      "run.failed",
    ]);
    expect(logger.entries[1]).toMatchObject({
      level: "error",
      detail: { runId: "run-1" },
    });
    expect(logger.entries[1]?.detail?.["error"]).toContain(
      "provider 连接被拒绝",
    );
    expect(JSON.stringify(logger.entries)).not.toContain("绝密案件信息");
  });

  it("容量拒绝与事件缓冲裁剪留下告警，裁剪只告警一次", async () => {
    const logger = createRecordingLogger();
    const harness = createHarness({
      runtime: { maxConcurrentRuns: 1, maxEventsPerRun: 16 },
      promptImpl: hanging,
      logger,
      createProjector: () => createRunEventProjector(),
    });
    await harness.registry.create({
      sessionId: "session-1",
      runId: "run-1",
      message: "a",
    });
    await waitUntil(() => harness.sessions.length === 1);

    const rejected = await harness.registry.create({
      sessionId: "session-1",
      runId: "run-2",
      message: "b",
    });
    expect(rejected.kind).toBe("rejected");

    for (let index = 0; index < 30; index += 1) {
      harness.sessions[0]?.emit({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: `第${index}段` },
      } as unknown as AgentSessionEvent);
    }

    const events = logger.entries.map((entry) => entry.event);
    expect(events).toContain("run.rejected.capacity-exceeded");
    expect(
      events.filter((event) => event === "run.event-buffer-truncated"),
    ).toHaveLength(1);
  });
});
