import { describe, expect, it } from "vitest";
import type {
  AgentRunCreateRequest,
  AgentRunEvent,
  AgentRunSnapshot,
} from "@renewal/contracts";
import type { ChatLogger } from "../../../src/application/chat/chat-logger.js";
import {
  ChatRunCoordinator,
  ChatRunNotFoundError,
  type ChatRunAgentClient,
} from "../../../src/application/chat/chat-run-coordinator.js";
import { ChatServiceClosedError } from "../../../src/application/chat/chat-service-closed-error.js";
import { ChatSessionService } from "../../../src/application/chat/chat-session-service.js";
import { InMemoryChatSessionStore } from "../../../src/infrastructure/persistence/in-memory-chat-session-store.js";

/**
 * run 协调器测试。
 *
 * 用可控假 Agent 流验证：增量收敛为一条助手消息、终态唯一、浏览器断开不影响
 * 服务端消费、上游异常按失败收敛、run 幂等、保留期回收与优雅关闭。
 */

const BASE_TIME = Date.parse("2026-09-20T00:00:00.000Z");

/** 可控事件流：测试逐条推送事件，模拟上游 SSE 的到达节奏。 */
class ControlledRun {
  private readonly queue: AgentRunEvent[] = [];
  private waiter:
    | ((
        result:
          | { readonly kind: "event"; readonly event: AgentRunEvent }
          | { readonly kind: "end" }
          | { readonly kind: "error" },
      ) => void)
    | null = null;
  private ended = false;
  private failed = false;

  push(event: AgentRunEvent): void {
    if (this.waiter !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ kind: "event", event });
      return;
    }
    this.queue.push(event);
  }

  finish(): void {
    this.ended = true;
    this.wake();
  }

  fail(): void {
    this.failed = true;
    this.ended = true;
    this.wake();
  }

  async take(): Promise<
    | { readonly kind: "event"; readonly event: AgentRunEvent }
    | { readonly kind: "end" }
    | { readonly kind: "error" }
  > {
    const next = this.queue.shift();
    if (next !== undefined) return { kind: "event", event: next };
    if (this.ended) return this.failed ? { kind: "error" } : { kind: "end" };
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  private wake(): void {
    if (this.waiter === null) return;
    const resolve = this.waiter;
    this.waiter = null;
    resolve(this.failed ? { kind: "error" } : { kind: "end" });
  }
}

/** 假 Agent：记录创建请求，返回可控事件流。 */
class FakeAgent implements ChatRunAgentClient {
  readonly createCalls: AgentRunCreateRequest[] = [];
  createError: unknown;
  /** 事件流生成器启动时抛出的错误（可携带稳定拒绝形状）。 */
  streamError: unknown;
  private readonly runs = new Map<string, ControlledRun>();

  async createRun(request: AgentRunCreateRequest): Promise<AgentRunSnapshot> {
    this.createCalls.push(request);
    if (this.createError !== undefined) throw this.createError;
    return {
      agentName: "insurance-agent",
      sessionId: request.sessionId,
      runId: request.runId,
      status: "accepted",
      createdAt: new Date(BASE_TIME).toISOString(),
    };
  }

  async *streamEvents(runId: string): AsyncGenerator<AgentRunEvent> {
    if (this.streamError !== undefined) throw this.streamError;
    const run = this.control(runId);
    for (;;) {
      const next = await run.take();
      if (next.kind === "end") return;
      if (next.kind === "error") throw new Error("上游内部错误详情");
      yield next.event;
    }
  }

  control(runId: string): ControlledRun {
    const existing = this.runs.get(runId);
    if (existing !== undefined) return existing;
    const created = new ControlledRun();
    this.runs.set(runId, created);
    return created;
  }
}

/** 记录日志事件名与字段，供脱敏断言使用。 */
class CapturingLogger implements ChatLogger {
  readonly entries: Array<{
    readonly level: "info" | "warn";
    readonly event: string;
    readonly fields: Record<string, string | number | boolean>;
  }> = [];

  info(
    event: string,
    fields?: Record<string, string | number | boolean>,
  ): void {
    this.entries.push({ level: "info", event, fields: fields ?? {} });
  }

  warn(
    event: string,
    fields?: Record<string, string | number | boolean>,
  ): void {
    this.entries.push({ level: "warn", event, fields: fields ?? {} });
  }
}

/** 构造协调器与依赖。 */
function createHarness(
  options: { retentionMs?: number; shutdownTimeoutMs?: number } = {},
) {
  let tick = 0;
  let id = 0;
  let clock = BASE_TIME;
  const store = new InMemoryChatSessionStore();
  const sessions = new ChatSessionService({
    store,
    now: () => new Date(BASE_TIME + tick++ * 1_000),
    newId: () => `id-${++id}`,
  });
  const agent = new FakeAgent();
  const logger = new CapturingLogger();
  const coordinator = new ChatRunCoordinator({
    sessions,
    agentClient: agent,
    logger,
    now: () => clock,
    ...(options.retentionMs === undefined
      ? {}
      : { retentionMs: options.retentionMs }),
    ...(options.shutdownTimeoutMs === undefined
      ? {}
      : { shutdownTimeoutMs: options.shutdownTimeoutMs }),
  });
  return {
    store,
    sessions,
    agent,
    logger,
    coordinator,
    advanceClock: (ms: number) => {
      clock += ms;
    },
  };
}

/** 事件构造器。 */
function event(
  runId: string,
  sessionId: string,
  type: AgentRunEvent["type"],
  cursor: number,
  extra: Record<string, unknown> = {},
): AgentRunEvent {
  return {
    agentName: "insurance-agent",
    sessionId,
    runId,
    cursor,
    at: new Date(BASE_TIME).toISOString(),
    type,
    ...extra,
  } as AgentRunEvent;
}

/** 收集订阅事件直到终态或结束。 */
async function collect(subscription: {
  next(): Promise<AgentRunEvent | null>;
}): Promise<AgentRunEvent[]> {
  const events: AgentRunEvent[] = [];
  for (;;) {
    const next = await subscription.next();
    if (next === null) return events;
    events.push(next);
  }
}

/** 等待条件成立（用于断言后台消费结果）。 */
async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("等待条件超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("ChatRunCoordinator 事件收敛", () => {
  it("增量收敛为一条助手消息并在终态后持久化", async () => {
    const { sessions, agent, coordinator } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });

    const subscription = coordinator.subscribe("run-1");
    agent.control("run-1").push(event("run-1", sessionId, "run.accepted", 1));
    agent
      .control("run-1")
      .push(event("run-1", sessionId, "answer.delta", 2, { text: "车险" }));
    agent
      .control("run-1")
      .push(event("run-1", sessionId, "answer.delta", 3, { text: "续保" }));
    agent.control("run-1").push(event("run-1", sessionId, "run.completed", 4));

    const events = await collect(subscription);
    expect(events.map((item) => item.type)).toEqual([
      "run.accepted",
      "answer.delta",
      "answer.delta",
      "run.completed",
    ]);

    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]?.role).toBe("assistant");
    expect(detail.messages[1]?.text).toBe("车险续保");
    expect(detail.messages[1]?.status).toBe("completed");
  });

  it("终态之后订阅返回 null，事件不重复", async () => {
    const { sessions, agent, coordinator } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });

    const control = agent.control("run-1");
    control.push(
      event("run-1", sessionId, "answer.delta", 1, { text: "回答" }),
    );
    control.push(event("run-1", sessionId, "run.completed", 2));

    const first = await collect(coordinator.subscribe("run-1"));
    expect(first).toHaveLength(2);
    expect(first[1]?.type).toBe("run.completed");

    // 后加入的订阅者从第一个事件开始回放，同样看到唯一终态。
    const second = await collect(coordinator.subscribe("run-1"));
    expect(second.map((item) => item.cursor)).toEqual([1, 2]);
  });

  it("多个订阅者都收到同一组事件", async () => {
    const { sessions, agent, coordinator } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });

    const a = coordinator.subscribe("run-1");
    const b = coordinator.subscribe("run-1");
    const control = agent.control("run-1");
    control.push(
      event("run-1", sessionId, "answer.delta", 1, { text: "文本" }),
    );
    control.push(event("run-1", sessionId, "run.completed", 2));

    const [eventsA, eventsB] = await Promise.all([collect(a), collect(b)]);
    expect(eventsA.map((item) => item.cursor)).toEqual([1, 2]);
    expect(eventsB.map((item) => item.cursor)).toEqual([1, 2]);
  });

  it("浏览器断开订阅不影响服务端消费与保存", async () => {
    const { sessions, agent, coordinator } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });

    const subscription = coordinator.subscribe("run-1");
    subscription.close();

    const control = agent.control("run-1");
    control.push(
      event("run-1", sessionId, "answer.delta", 1, { text: "离开页" }),
    );
    control.push(
      event("run-1", sessionId, "answer.delta", 2, { text: "面后回答" }),
    );
    control.push(event("run-1", sessionId, "run.completed", 3));

    await waitFor(async () => {
      const current = await sessions.getSessionDetail(sessionId);
      return current.messages[1]?.status === "completed";
    });

    const final = await sessions.getSessionDetail(sessionId);
    expect(final.messages[1]?.text).toBe("离开页面后回答");
  });

  it("run.failed 终态保存为失败状态且不写入错误详情", async () => {
    const { sessions, agent, coordinator } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });

    const control = agent.control("run-1");
    control.push(
      event("run-1", sessionId, "answer.delta", 1, { text: "部分" }),
    );
    control.push(
      event("run-1", sessionId, "run.failed", 2, {
        errorCode: "INTERNAL_ERROR",
      }),
    );

    const events = await collect(coordinator.subscribe("run-1"));
    expect(events[1]?.type).toBe("run.failed");

    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages[1]?.status).toBe("failed");
    expect(JSON.stringify(detail)).not.toContain("INTERNAL_ERROR");
  });

  it("上游在终态前结束按失败收敛", async () => {
    const { sessions, agent, coordinator } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });

    const control = agent.control("run-1");
    control.push(
      event("run-1", sessionId, "answer.delta", 1, { text: "部分" }),
    );
    control.finish();

    const events = await collect(coordinator.subscribe("run-1"));
    expect(events.map((item) => item.type)).toEqual(["answer.delta"]);

    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages[1]?.status).toBe("failed");
  });

  it("上游抛错时按失败收敛且错误详情不进入会话", async () => {
    const { sessions, agent, coordinator } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });

    const control = agent.control("run-1");
    control.push(
      event("run-1", sessionId, "answer.delta", 1, { text: "部分" }),
    );
    control.fail();

    await collect(coordinator.subscribe("run-1"));
    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages[1]?.status).toBe("failed");
    expect(JSON.stringify(detail)).not.toContain("内部错误详情");
  });
});

describe("ChatRunCoordinator run 幂等与失败保留", () => {
  it("相同 runId 重复提交复用既有快照且不重复调用 Agent", async () => {
    const { sessions, coordinator, agent } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;

    const first = await coordinator.startRun({
      sessionId,
      runId: "run-1",
      message: "你好",
    });
    const second = await coordinator.startRun({
      sessionId,
      runId: "run-1",
      message: "你好",
    });

    expect(second).toEqual(first);
    expect(agent.createCalls).toHaveLength(1);
    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.status).toBe("accepted");
  });

  it("Agent 拒绝创建时保留用户消息并标记发送失败", async () => {
    const { sessions, coordinator, agent } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    agent.createError = new Error("Agent 不可用");

    await expect(
      coordinator.startRun({ sessionId, runId: "run-1", message: "未发送" }),
    ).rejects.toThrow("Agent 不可用");

    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.text).toBe("未发送");
    expect(detail.messages[0]?.status).toBe("send-failed");
  });

  it("对不存在会话发送直接失败且不调用 Agent", async () => {
    const { coordinator, agent } = createHarness();

    await expect(
      coordinator.startRun({
        sessionId: "missing",
        runId: "run-1",
        message: "你好",
      }),
    ).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
    expect(agent.createCalls).toHaveLength(0);
  });

  it("并发相同 runId 重复提交只调用一次 Agent 且消息不重复", async () => {
    const { sessions, coordinator, agent } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;

    const [first, second] = await Promise.all([
      coordinator.startRun({ sessionId, runId: "run-1", message: "你好" }),
      coordinator.startRun({ sessionId, runId: "run-1", message: "你好" }),
    ]);

    expect(second).toEqual(first);
    expect(agent.createCalls).toHaveLength(1);
    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages).toHaveLength(1);
  });

  it("createRun 失败后相同 runId 重试会重建通道并正常收敛", async () => {
    const { sessions, coordinator, agent } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;

    agent.createError = new Error("Agent 不可用");
    await expect(
      coordinator.startRun({ sessionId, runId: "run-1", message: "你好" }),
    ).rejects.toThrow("Agent 不可用");

    agent.createError = undefined;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });

    const control = agent.control("run-1");
    control.push(event("run-1", sessionId, "run.completed", 1));
    control.finish();

    const events = await collect(coordinator.subscribe("run-1"));
    expect(events.map((item) => item.type)).toEqual(["run.completed"]);
    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages[0]?.status).toBe("accepted");
  });

  it("上游稳定拒绝记录在通道上，供 SSE 空流回放", async () => {
    const { sessions, coordinator, agent } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    agent.streamError = Object.assign(new Error("Agent 拒绝"), {
      kind: "service",
      statusCode: 404,
      serviceError: { code: "RUN_NOT_FOUND", retryable: false },
    });

    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });
    const events = await collect(coordinator.subscribe("run-1"));

    expect(events).toEqual([]);
    expect(coordinator.getUpstreamRejection("run-1")).toEqual({
      code: "RUN_NOT_FOUND",
      retryable: false,
      statusCode: 404,
    });
  });
});

describe("ChatRunCoordinator 订阅边界与回收", () => {
  it("订阅未知 run 返回 RUN_NOT_FOUND", () => {
    const { coordinator } = createHarness();
    expect(() => coordinator.subscribe("missing")).toThrow(
      ChatRunNotFoundError,
    );
  });

  it("终态 run 超过保留期后不可订阅", async () => {
    const { sessions, agent, coordinator, advanceClock } = createHarness({
      retentionMs: 1_000,
    });
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });
    agent.control("run-1").push(event("run-1", sessionId, "run.completed", 1));
    const events = await collect(coordinator.subscribe("run-1"));
    expect(events).toHaveLength(1);

    advanceClock(2_000);
    expect(() => coordinator.subscribe("run-1")).toThrow(ChatRunNotFoundError);
  });

  it("关闭后拒绝新 run 并收敛未完成的 run", async () => {
    const { sessions, coordinator, agent } = createHarness({
      shutdownTimeoutMs: 50,
    });
    const sessionId = (await sessions.createSession()).session.sessionId;
    await coordinator.startRun({ sessionId, runId: "run-1", message: "你好" });
    // 上游保持挂起：模拟关闭时仍有活动 run。
    agent
      .control("run-1")
      .push(event("run-1", sessionId, "answer.delta", 1, { text: "部分回答" }));

    const subscription = coordinator.subscribe("run-1");
    await subscription.next();
    await coordinator.close();

    expect(await subscription.next()).toBeNull();
    await expect(
      coordinator.startRun({ sessionId, runId: "run-2", message: "你好" }),
    ).rejects.toBeInstanceOf(ChatServiceClosedError);

    const detail = await sessions.getSessionDetail(sessionId);
    expect(detail.messages[1]?.status).toBe("failed");
  });
});

describe("ChatRunCoordinator 日志脱敏", () => {
  it("日志只记录 ID 与事件名，不含消息正文与回答", async () => {
    const { sessions, agent, coordinator, logger } = createHarness();
    const sessionId = (await sessions.createSession()).session.sessionId;
    const secret = "身份证号110101199001011234";
    await coordinator.startRun({ sessionId, runId: "run-1", message: secret });

    const control = agent.control("run-1");
    control.push(
      event("run-1", sessionId, "answer.delta", 1, { text: "回答正文" }),
    );
    control.push(event("run-1", sessionId, "run.completed", 2));
    await collect(coordinator.subscribe("run-1"));

    const serialized = JSON.stringify(logger.entries);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("回答正文");
    expect(logger.entries.map((entry) => entry.event)).toContain(
      "chat.run.accepted",
    );
  });
});
