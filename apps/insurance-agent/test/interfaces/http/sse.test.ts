import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@renewal/contracts/agent";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createRunEventProjector } from "../../../src/runtime/run_event_projector.js";
import {
  buildConfig,
  createRecordingLogger,
  createRegistryHarness,
  hanging,
  type RegistryHarness,
} from "../../support/agent_fixtures.js";
import { createAgentHttpServer } from "../../../src/interfaces/http/server.js";
import type { AgentRunLogger } from "../../../src/runtime/run_registry.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** 在随机端口启动测试服务并返回 baseUrl。 */
async function startServer(
  harness: RegistryHarness,
  logger?: AgentRunLogger,
): Promise<string> {
  const server = createAgentHttpServer({
    config: buildConfig(),
    registry: harness.registry,
    state: { ready: true, reasons: [], warnings: [] },
    ...(logger === undefined ? {} : { logger }),
  });
  servers.push(server);
  return server.listen({ host: "127.0.0.1", port: 0 });
}

/** 创建一个 run 并断言返回 202。 */
async function createRun(baseUrl: string, runId = "run-1"): Promise<void> {
  const response = await fetch(`${baseUrl}/internal/agent/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "session-1", runId, message: "你好" }),
  });
  expect(response.status).toBe(202);
}

/** 轮询等待条件成立，超时即失败。 */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待条件超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 构造文本增量 SDK 事件替身。 */
function textDelta(delta: string): AgentSessionEvent {
  return {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta },
  } as unknown as AgentSessionEvent;
}

/** 读取 SSE 事件直到满足条件或流结束。 */
async function collectEvents(
  response: Response,
  enough: (events: AgentRunEvent[]) => boolean,
): Promise<AgentRunEvent[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("SSE 响应没有可读流");

  const decoder = new TextDecoder();
  const events: AgentRunEvent[] = [];
  let buffer = "";

  try {
    while (!enough(events)) {
      const chunk = await reader.read();
      if (chunk.done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });

      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (dataLine !== undefined) {
          events.push(JSON.parse(dataLine.slice(6)) as AgentRunEvent);
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return events;
}

describe("SSE 事件流", () => {
  it("首次订阅按 cursor 顺序收到已缓冲事件", async () => {
    const harness = createRegistryHarness({ promptImpl: hanging });
    const baseUrl = await startServer(harness);
    await createRun(baseUrl);
    await waitUntil(
      () => harness.registry.getSnapshot("run-1")?.status === "running",
    );

    const response = await fetch(`${baseUrl}/internal/agent/runs/run-1/events`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await collectEvents(response, (list) => list.length >= 2);

    expect(events.map((event) => event.type)).toEqual([
      "run.accepted",
      "agent.started",
    ]);
    expect(events.map((event) => event.cursor)).toEqual([1, 2]);
  });

  it("带 after 重连时从下一条事件续接且不重复", async () => {
    const harness = createRegistryHarness({
      promptImpl: hanging,
      createProjector: () => createRunEventProjector(),
    });
    const baseUrl = await startServer(harness);
    await createRun(baseUrl);
    await waitUntil(() => harness.sessions.length === 1);

    const first = await collectEvents(
      await fetch(`${baseUrl}/internal/agent/runs/run-1/events`),
      (list) => list.length >= 2,
    );
    const lastCursor = first.at(-1)?.cursor ?? 0;

    harness.sessions[0]?.emit(textDelta("续保方案"));

    const resumed = await collectEvents(
      await fetch(
        `${baseUrl}/internal/agent/runs/run-1/events?after=${lastCursor}`,
      ),
      (list) => list.length >= 1,
    );

    expect(resumed[0]?.cursor).toBe(lastCursor + 1);
    expect(resumed[0]).toMatchObject({
      type: "answer.delta",
      text: "续保方案",
    });
  });

  it("支持 Last-Event-ID 头续接", async () => {
    const harness = createRegistryHarness({
      promptImpl: hanging,
      createProjector: () => createRunEventProjector(),
    });
    const baseUrl = await startServer(harness);
    await createRun(baseUrl);
    await waitUntil(() => harness.sessions.length === 1);

    harness.sessions[0]?.emit(textDelta("第一段"));

    const resumed = await collectEvents(
      await fetch(`${baseUrl}/internal/agent/runs/run-1/events`, {
        headers: { "last-event-id": "2" },
      }),
      (list) => list.length >= 1,
    );

    expect(resumed[0]?.cursor).toBe(3);
  });

  it("cursor 过旧时返回 409 EVENT_CURSOR_EXPIRED", async () => {
    const harness = createRegistryHarness({
      runtime: { maxEventsPerRun: 16 },
      promptImpl: hanging,
      createProjector: () => createRunEventProjector(),
    });
    const baseUrl = await startServer(harness);
    await createRun(baseUrl);
    await waitUntil(() => harness.sessions.length === 1);
    for (let index = 0; index < 30; index += 1) {
      harness.sessions[0]?.emit(textDelta(`第${index}段`));
    }

    const response = await fetch(
      `${baseUrl}/internal/agent/runs/run-1/events?after=1`,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "EVENT_CURSOR_EXPIRED" },
    });
  });

  it("run 进入终态后事件流自动结束", async () => {
    const harness = createRegistryHarness();
    const baseUrl = await startServer(harness);
    await createRun(baseUrl);

    const events = await collectEvents(
      await fetch(`${baseUrl}/internal/agent/runs/run-1/events`),
      () => false,
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.accepted",
      "agent.started",
      "run.completed",
    ]);
  });

  it("客户端断开只释放订阅，不停止 run", async () => {
    let finishPrompt: (() => void) | undefined;
    const harness = createRegistryHarness({
      promptImpl: () =>
        new Promise<void>((resolve) => {
          finishPrompt = resolve;
        }),
    });
    const baseUrl = await startServer(harness);
    await createRun(baseUrl);
    await waitUntil(
      () => harness.registry.getSnapshot("run-1")?.status === "running",
    );

    const controller = new AbortController();
    const response = await fetch(
      `${baseUrl}/internal/agent/runs/run-1/events`,
      {
        signal: controller.signal,
      },
    );
    await collectEvents(response, (list) => list.length >= 2);
    controller.abort();

    expect(harness.registry.getSnapshot("run-1")?.status).toBe("running");

    finishPrompt?.();
    await waitUntil(() => harness.registry.isTerminal("run-1"));

    expect(harness.registry.getSnapshot("run-1")?.status).toBe("completed");
  });

  it("SSE 订阅与终态关闭写入运行日志", async () => {
    const logger = createRecordingLogger();
    const harness = createRegistryHarness();
    const baseUrl = await startServer(harness, logger);
    await createRun(baseUrl);

    await collectEvents(
      await fetch(`${baseUrl}/internal/agent/runs/run-1/events`),
      () => false,
    );

    const events = logger.entries.map((entry) => entry.event);
    expect(events).toContain("sse.subscribed");
    expect(
      logger.entries.find((entry) => entry.event === "sse.closed")?.detail,
    ).toMatchObject({ runId: "run-1", reason: "terminal" });
  });
});
