import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@renewal/contracts/agent";
import { createApiApp } from "../../../src/bootstrap/application.js";
import { createFakeDatabase } from "../../support/fake-database.js";
import { AgentServiceClient } from "../../../src/infrastructure/agent/agent-service-client.js";
import { InMemoryChatSessionStore } from "../../../src/infrastructure/persistence/in-memory-chat-session-store.js";

/**
 * 对话 run 路由集成测试。
 *
 * 真实 `AgentServiceClient` + 本地 fake insurance-agent HTTP/SSE 服务 + 真实监听端口，
 * 覆盖创建校验、会话校验、错误映射、SSE 顺序转发、终态关闭、浏览器断开后的
 * 服务端续跑与保存，以及公开错误不泄露内部信息。
 */

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

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
    at: "2026-09-20T00:00:00.000Z",
    type,
    ...extra,
  } as AgentRunEvent;
}

interface FakeAgent {
  readonly baseUrl: string;
  /** 收到的创建请求（含正文，用于断言只转发一次）。 */
  readonly requests: Array<{
    sessionId: string;
    runId: string;
    message: string;
  }>;
  /** 上游 SSE 连接被下游取消的次数。 */
  readonly upstreamCloses: number;
  /** 向指定 run 推送一个 SSE 事件；返回是否已建立连接。 */
  emit(runId: string, payload: AgentRunEvent): boolean;
  /** 结束指定 run 的 SSE 连接。 */
  end(runId: string): void;
}

/** 启动可脚本化推送事件的 fake insurance-agent。 */
async function startFakeAgent(
  options: {
    readonly createStatus?: number;
    readonly createErrorBody?: unknown;
    /** 事件端点返回的状态码；非 200 时模拟 Agent 丢失 run。 */
    readonly eventsStatus?: number;
  } = {},
): Promise<FakeAgent> {
  const requests: Array<{
    sessionId: string;
    runId: string;
    message: string;
  }> = [];
  const streams = new Map<string, ServerResponse>();
  let upstreamCloses = 0;

  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      if (request.method === "POST" && request.url === "/internal/agent/runs") {
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        request.on("end", () => {
          const parsed = JSON.parse(body) as {
            sessionId: string;
            runId: string;
            message: string;
          };
          requests.push(parsed);
          const status = options.createStatus ?? 202;
          response.writeHead(status, { "content-type": "application/json" });
          if (status !== 202 && options.createErrorBody !== undefined) {
            response.end(JSON.stringify(options.createErrorBody));
            return;
          }
          response.end(
            JSON.stringify({
              agentName: "insurance-agent",
              sessionId: parsed.sessionId,
              runId: parsed.runId,
              status: "accepted",
              createdAt: "2026-09-20T00:00:00.000Z",
            }),
          );
        });
        return;
      }

      if (
        request.method === "GET" &&
        request.url?.startsWith("/internal/agent/runs/") &&
        request.url.endsWith("/events")
      ) {
        const runId = decodeURIComponent(
          request.url.slice("/internal/agent/runs/".length, -"/events".length),
        );
        if (
          options.eventsStatus !== undefined &&
          options.eventsStatus !== 200
        ) {
          response.writeHead(options.eventsStatus, {
            "content-type": "application/json",
          });
          response.end(
            JSON.stringify({
              error: {
                code: "RUN_NOT_FOUND",
                message: "指定的 run 不存在",
                retryable: false,
              },
            }),
          );
          return;
        }
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
        });
        streams.set(runId, response);
        request.on("close", () => {
          upstreamCloses += 1;
          streams.delete(runId);
        });
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            code: "RUN_NOT_FOUND",
            message: "指定的 run 不存在",
            retryable: false,
          },
        }),
      );
    },
  );

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      }),
  );

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake Agent 未返回监听端口");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    get upstreamCloses() {
      return upstreamCloses;
    },
    emit(runId, payload): boolean {
      const stream = streams.get(runId);
      if (stream === undefined) return false;
      stream.write(
        `id: ${payload.cursor}\ndata: ${JSON.stringify(payload)}\n\n`,
      );
      return true;
    },
    end(runId): void {
      streams.get(runId)?.end();
      streams.delete(runId);
    },
  };
}

/** 启动待测 API（真实端口，供 SSE 客户端断开测试）。 */
async function startApi(agentBaseUrl: string): Promise<{
  readonly baseUrl: string;
  readonly sessions: InMemoryChatSessionStore;
  close(): Promise<void>;
}> {
  const sessions = new InMemoryChatSessionStore();
  const app = createApiApp({
    // 端口固定为 0：同一测试文件会启动多个应用，不能共用默认端口。
    config: {
      host: "127.0.0.1",
      port: 0,
      agentBaseUrl,
      agentConnectTimeoutMs: 500,
      agentResponseTimeoutMs: 5_000,
    },
    agentClient: new AgentServiceClient({
      baseUrl: agentBaseUrl,
      connectTimeoutMs: 500,
      responseTimeoutMs: 5_000,
    }),
    sessionStore: sessions,
    // 本文件只验证对话链路，不连接真实数据库。
    database: createFakeDatabase(),
    logger: { info: () => undefined, warn: () => undefined },
  });
  const baseUrl = await app.listen();
  cleanup.push(() => app.close());
  return { baseUrl, sessions, close: () => app.close() };
}

/** 通过 HTTP 创建会话。 */
async function createSession(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/chat/sessions`, {
    method: "POST",
  });
  const payload = (await response.json()) as {
    session: { sessionId: string };
  };
  return payload.session.sessionId;
}

/** 读取会话详情。 */
async function readDetail(
  baseUrl: string,
  sessionId: string,
): Promise<{
  readonly session: { readonly title: string };
  readonly messages: readonly {
    readonly role: string;
    readonly text: string;
    readonly status: string;
  }[];
}> {
  const response = await fetch(
    `${baseUrl}/api/chat/sessions/${encodeURIComponent(sessionId)}`,
  );
  expect(response.status).toBe(200);
  return response.json();
}

/** 读取 SSE 响应直到流结束或满足 enough。 */
async function collectSse(
  response: Response,
  enough?: (events: AgentRunEvent[]) => boolean,
): Promise<AgentRunEvent[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("SSE 响应没有可读流");
  const decoder = new TextDecoder();
  const events: AgentRunEvent[] = [];
  let buffer = "";
  try {
    for (;;) {
      if (enough !== undefined && enough(events)) break;
      const chunk = await reader.read();
      if (chunk.done) break;
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

/** 轮询直到条件成立。 */
async function waitFor(
  condition: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("POST /api/chat/runs", () => {
  it("成功创建 run：返回 202 快照、消息只转发一次并已保存", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    const response = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      sessionId,
      runId: "run-1",
      status: "accepted",
    });
    expect(agent.requests).toEqual([
      { sessionId, runId: "run-1", message: "你好" },
    ]);

    const detail = await readDetail(api.baseUrl, sessionId);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]).toMatchObject({
      role: "user",
      text: "你好",
      status: "accepted",
    });
    // 首条消息自动命名标题。
    expect(detail.session.title).toBe("你好");
  });

  it("空白/缺失/错误类型字段返回 400 且不调用 Agent", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);

    for (const body of [
      {},
      { sessionId: "s", runId: "r", message: "   " },
      { sessionId: "", runId: "r", message: "你好" },
      { sessionId: 1, runId: "r", message: "你好" },
      { sessionId: "s", runId: "r" },
    ]) {
      const response = await fetch(`${api.baseUrl}/api/chat/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(
        (await response.json()) as { error: { code: string } },
      ).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    }
    expect(agent.requests).toHaveLength(0);
  });

  it("不存在的 session 返回 404 且不保存、不调用 Agent", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);

    const response = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "missing",
        runId: "run-1",
        message: "你好",
      }),
    });

    expect(response.status).toBe(404);
    expect(
      (await response.json()) as { error: { code: string } },
    ).toMatchObject({ error: { code: "CHAT_SESSION_NOT_FOUND" } });
    expect(agent.requests).toHaveLength(0);
  });

  it("相同 runId 重复提交不重复调用 Agent 也不重复保存消息", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);
    const body = JSON.stringify({ sessionId, runId: "run-1", message: "你好" });

    const first = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const second = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(agent.requests).toHaveLength(1);
    const detail = await readDetail(api.baseUrl, sessionId);
    expect(detail.messages).toHaveLength(1);
  });

  it("跨会话复用 runId 返回 400 INVALID_REQUEST 且不写入消息", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);
    const sessionA = await createSession(api.baseUrl);
    const sessionB = await createSession(api.baseUrl);

    const first = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionA,
        runId: "run-1",
        message: "你好",
      }),
    });
    const second = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionB,
        runId: "run-1",
        message: "你好",
      }),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(400);
    const payload = (await second.json()) as {
      error: { code: string; retryable: boolean };
    };
    expect(payload.error.code).toBe("INVALID_REQUEST");
    expect(payload.error.retryable).toBe(false);
    const detail = await readDetail(api.baseUrl, sessionB);
    expect(detail.messages).toHaveLength(0);
  });

  it("Agent 稳定服务错误保留错误码与 retryable，并标记用户消息发送失败", async () => {
    const agent = await startFakeAgent({
      createStatus: 503,
      createErrorBody: {
        error: {
          code: "CAPACITY_EXCEEDED",
          message: "内部信息",
          retryable: true,
        },
      },
    });
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    const response = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });

    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      error: { code: string; message: string; retryable: boolean };
    };
    expect(payload.error.code).toBe("CAPACITY_EXCEEDED");
    expect(payload.error.retryable).toBe(true);
    expect(payload.error.message).not.toContain("内部信息");

    const detail = await readDetail(api.baseUrl, sessionId);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.status).toBe("send-failed");
  });

  it("连接失败映射为脱敏 SERVICE_NOT_READY", async () => {
    const agent = await startFakeAgent();
    // 关闭 fake Agent，模拟服务不可达。
    await cleanup.pop()?.();
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    const response = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });

    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe("SERVICE_NOT_READY");
    expect(payload.error.message).not.toMatch(/127\.0\.0\.1|ECONN/);
  });
});

describe("GET /api/chat/runs/:runId/events", () => {
  it("按 cursor 顺序转发增量并以 run.completed 关闭，同时保存回答", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });
    await waitFor(
      async () =>
        agent.emit("run-1", event("run-1", sessionId, "run.accepted", 1)),
      "上游连接建立",
    );

    const response = await fetch(`${api.baseUrl}/api/chat/runs/run-1/events`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");

    agent.emit(
      "run-1",
      event("run-1", sessionId, "answer.delta", 2, { text: "车险" }),
    );
    agent.emit(
      "run-1",
      event("run-1", sessionId, "answer.delta", 3, { text: "续保" }),
    );
    agent.emit("run-1", event("run-1", sessionId, "run.completed", 4));
    agent.end("run-1");

    const events = await collectSse(response);
    expect(events.map((item) => item.cursor)).toEqual([1, 2, 3, 4]);
    expect(events.map((item) => item.type)).toEqual([
      "run.accepted",
      "answer.delta",
      "answer.delta",
      "run.completed",
    ]);

    await waitFor(async () => {
      const detail = await readDetail(api.baseUrl, sessionId);
      return detail.messages[1]?.status === "completed";
    }, "回答保存完成");

    const detail = await readDetail(api.baseUrl, sessionId);
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1]).toMatchObject({
      role: "assistant",
      text: "车险续保",
      status: "completed",
    });
  });

  it("run.failed 且无增量时不创建空助手消息", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });
    await waitFor(
      async () =>
        agent.emit(
          "run-1",
          event("run-1", sessionId, "run.failed", 1, {
            errorCode: "INTERNAL_ERROR",
          }),
        ),
      "上游连接建立",
    );

    const response = await fetch(`${api.baseUrl}/api/chat/runs/run-1/events`);
    const events = await collectSse(response);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "run.failed", cursor: 1 });

    const detail = await readDetail(api.baseUrl, sessionId);
    // 用户消息保留，且因为没有增量而未创建空助手消息。
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.status).toBe("accepted");
    expect(JSON.stringify(detail)).not.toContain("INTERNAL_ERROR");
  });

  it("run.failed 有增量时助手消息保存为失败状态", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });
    await waitFor(
      async () =>
        agent.emit(
          "run-1",
          event("run-1", sessionId, "answer.delta", 1, { text: "部分回答" }),
        ),
      "上游连接建立",
    );

    const response = await fetch(`${api.baseUrl}/api/chat/runs/run-1/events`);
    agent.emit(
      "run-1",
      event("run-1", sessionId, "run.failed", 2, {
        errorCode: "INTERNAL_ERROR",
      }),
    );
    const events = await collectSse(response);
    expect(events.map((item) => item.type)).toEqual([
      "answer.delta",
      "run.failed",
    ]);

    await waitFor(async () => {
      const detail = await readDetail(api.baseUrl, sessionId);
      return detail.messages[1]?.status === "failed";
    }, "失败状态保存");

    const detail = await readDetail(api.baseUrl, sessionId);
    expect(detail.messages[1]).toMatchObject({
      role: "assistant",
      text: "部分回答",
      status: "failed",
    });
    expect(JSON.stringify(detail)).not.toContain("INTERNAL_ERROR");
  });

  it("订阅本进程未创建的 run 在流建立前返回 404", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);

    const response = await fetch(`${api.baseUrl}/api/chat/runs/missing/events`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(
      (await response.json()) as { error: { code: string } },
    ).toMatchObject({ error: { code: "RUN_NOT_FOUND" } });
  });

  it("浏览器断开后 API 继续消费并把完整回答保存下来", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });
    await waitFor(
      async () =>
        agent.emit(
          "run-1",
          event("run-1", sessionId, "answer.delta", 1, { text: "离开" }),
        ),
      "上游连接建立",
    );

    const controller = new AbortController();
    const response = await fetch(`${api.baseUrl}/api/chat/runs/run-1/events`, {
      signal: controller.signal,
    });
    await collectSse(response, (events) => events.length >= 1);
    controller.abort();
    // 给断开信号一点传播时间，再确认上游订阅未被取消。
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(agent.upstreamCloses).toBe(0);

    // 浏览器离开后上游仍可推送事件，服务端继续消费并保存。
    expect(
      agent.emit(
        "run-1",
        event("run-1", sessionId, "answer.delta", 2, { text: "页面后回答" }),
      ),
    ).toBe(true);
    expect(
      agent.emit("run-1", event("run-1", sessionId, "run.completed", 3)),
    ).toBe(true);
    agent.end("run-1");

    await waitFor(async () => {
      const detail = await readDetail(api.baseUrl, sessionId);
      return detail.messages[1]?.status === "completed";
    }, "断开后回答保存");

    const detail = await readDetail(api.baseUrl, sessionId);
    expect(detail.messages[1]?.text).toBe("离开页面后回答");
  });

  it("Agent 事件端点丢失 run 时 SSE 返回其稳定错误码且不可重试", async () => {
    // 创建成功但事件端点 404：模拟 Agent 重启后丢失 run。
    const agent = await startFakeAgent({ eventsStatus: 404 });
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    const created = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });
    expect(created.status).toBe(202);

    // 订阅会等到后台消费因上游 404 收敛后返回空流，此时拒绝码已记录在通道上。
    const events = await fetch(`${api.baseUrl}/api/chat/runs/run-1/events`);
    expect(events.status).toBe(404);
    const payload = (await events.json()) as {
      error: { code: string; retryable: boolean };
    };
    expect(payload.error.code).toBe("RUN_NOT_FOUND");
    expect(payload.error.retryable).toBe(false);
  });
});

describe("公开错误映射不泄露内部信息", () => {
  it("错误响应不包含堆栈与用户正文", async () => {
    const agent = await startFakeAgent();
    const api = await startApi(agent.baseUrl);
    const sessionId = await createSession(api.baseUrl);

    const response = await fetch(`${api.baseUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, runId: "run-1", message: "你好" }),
    });
    // 上游 error 分支：通过不存在的 run 触发 JSON 错误响应。
    const missing = await fetch(
      `${api.baseUrl}/api/chat/runs/${encodeURIComponent("不存在")}/events`,
    );
    const text = `${await response.text()}${await missing.text()}`;

    expect(text).not.toMatch(/stack|at .*\(/i);
  });
});
