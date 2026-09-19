import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@renewal/contracts/agent";
import { AgentServiceClient } from "../../../src/infrastructure/agent/agent-service-client.js";
import { registerChatRoutes } from "../../../src/interfaces/http/chat-routes.js";

/**
 * chat 公开路由集成测试。
 *
 * 使用真实 AgentServiceClient + 本地 fake insurance-agent HTTP/SSE 服务，
 * 覆盖校验、转发、错误映射、SSE 顺序转发、终态关闭与客户端断开释放。
 */

type AgentHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

/** 启动 fake insurance-agent 并返回 baseUrl。 */
async function listenAgent(handler: AgentHandler): Promise<string> {
  const server = createServer(
    (request, response) => void handler(request, response),
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
  return `http://127.0.0.1:${address.port}`;
}

/** 启动待测 API（真实端口，供 SSE 客户端断开测试）。 */
async function startApi(agentBaseUrl: string): Promise<string> {
  const server = Fastify({ logger: false });
  const client = new AgentServiceClient({
    baseUrl: agentBaseUrl,
    connectTimeoutMs: 500,
    responseTimeoutMs: 2_000,
  });
  registerChatRoutes(server, { agentClient: client });
  cleanup.push(() => server.close());
  return server.listen({ host: "127.0.0.1", port: 0 });
}

/** 快照示例。 */
const snapshot = {
  agentName: "insurance-agent",
  sessionId: "session-1",
  runId: "run-1",
  status: "accepted" as const,
  createdAt: "2026-09-15T00:00:00.000Z",
};

/** SSE 事件构造器。 */
function event(
  type: AgentRunEvent["type"],
  cursor: number,
  extra: Record<string, unknown> = {},
): AgentRunEvent {
  return {
    agentName: "insurance-agent",
    sessionId: "session-1",
    runId: "run-1",
    cursor,
    at: "2026-09-15T00:00:00.00Z",
    type,
    ...extra,
  } as AgentRunEvent;
}

/** 读取 SSE 响应直到 enough 成立或流结束。 */
async function collectSse(
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

describe("POST /api/chat/runs", () => {
  it("成功创建 run：返回 202 快照且消息只转发一次", async () => {
    const received: Array<{ url: string; body: string }> = [];
    const agentUrl = await listenAgent(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      received.push({ url: request.url ?? "", body });
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify(snapshot));
    });
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        runId: "run-1",
        message: "你好",
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ url: "/internal/agent/runs" });
    expect(JSON.parse(received[0]!.body)).toEqual({
      sessionId: "session-1",
      runId: "run-1",
      message: "你好",
    });
  });

  it("空白/缺失/错误类型字段返回 400 且不调用 Agent 服务", async () => {
    let agentCalled = 0;
    const agentUrl = await listenAgent((_request, response) => {
      agentCalled += 1;
      response.writeHead(202);
      response.end(JSON.stringify(snapshot));
    });
    const apiUrl = await startApi(agentUrl);

    for (const body of [
      {},
      { sessionId: "s", runId: "r", message: "   " },
      { sessionId: "", runId: "r", message: "你好" },
      { sessionId: 1, runId: "r", message: "你好" },
      { sessionId: "s", runId: "r" },
      null,
    ]) {
      const response = await fetch(`${apiUrl}/api/chat/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      const payload = (await response.json()) as {
        error: { code: string };
      };
      expect(payload.error.code).toBe("INVALID_REQUEST");
    }
    expect(agentCalled).toBe(0);
  });

  it("Agent 稳定服务错误保留错误码与 retryable", async () => {
    const agentUrl = await listenAgent((_request, response) => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            code: "CAPACITY_EXCEEDED",
            message: "内部信息",
            retryable: true,
          },
        }),
      );
    });
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "s",
        runId: "r",
        message: "你好",
      }),
    });

    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      error: { code: string; message: string; retryable: boolean };
    };
    expect(payload.error.code).toBe("CAPACITY_EXCEEDED");
    expect(payload.error.retryable).toBe(true);
    // 不透出内部错误消息
    expect(payload.error.message).not.toContain("内部信息");
  });

  it("连接失败映射为脱敏 SERVICE_NOT_READY", async () => {
    const agentUrl = await listenAgent((_request, response) => {
      response.end();
    });
    await cleanup.pop()?.();
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "s",
        runId: "r",
        message: "你好",
      }),
    });

    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error).toMatchObject({ code: "SERVICE_NOT_READY" });
    expect(payload.error.message).not.toMatch(/127\.0\.0\.1|ECONN/);
  });
});

describe("GET /api/chat/runs/:runId/events", () => {
  it("按 cursor 顺序转发增量并以 run.completed 关闭", async () => {
    const agentUrl = await listenAgent((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const [index, e] of [
        event("run.accepted", 1),
        event("agent.started", 2),
        event("answer.delta", 3, { text: "第一段" }),
        event("answer.delta", 4, { text: "第二段" }),
        event("run.completed", 5),
      ].entries()) {
        response.write(`id: ${index + 1}\ndata: ${JSON.stringify(e)}\n\n`);
      }
      response.end();
    });
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs/run-1/events`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");

    const events = await collectSse(response, () => false);
    expect(events.map((e) => e.type)).toEqual([
      "run.accepted",
      "agent.started",
      "answer.delta",
      "answer.delta",
      "run.completed",
    ]);
    expect(events.map((e) => e.cursor)).toEqual([1, 2, 3, 4, 5]);
  });

  it("run.failed 终态转发后关闭", async () => {
    const agentUrl = await listenAgent((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `id: 1\ndata: ${JSON.stringify(event("run.failed", 1, { errorCode: "INTERNAL_ERROR" }))}\n\n`,
      );
      response.end();
    });
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs/run-1/events`);
    const events = await collectSse(response, () => false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "run.failed", cursor: 1 });
  });

  it("run.aborted 终态转发后关闭", async () => {
    const agentUrl = await listenAgent((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `id: 1\ndata: ${JSON.stringify(event("run.aborted", 1, { reason: "requested" }))}\n\n`,
      );
      response.end();
    });
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs/run-1/events`);
    const events = await collectSse(response, () => false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "run.aborted", cursor: 1 });
  });

  it("run 不存在时在流建立前返回稳定错误", async () => {
    const agentUrl = await listenAgent((_request, response) => {
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
    });
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs/missing/events`);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("RUN_NOT_FOUND");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("上游流异常中断时已写头则直接关闭下游", async () => {
    // 先发一个事件让响应头写出，然后直接 destroy 上游连接。
    const agentUrl = await listenAgent((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `id: 1\ndata: ${JSON.stringify(event("answer.delta", 1, { text: "部分" }))}\n\n`,
      );
      setTimeout(() => response.destroy(), 30);
    });
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs/run-1/events`);
    const events = await collectSse(response, () => false);
    expect(events.map((e) => e.type)).toEqual(["answer.delta"]);
  });

  it("浏览器断开后取消上游订阅且不 abort run", async () => {
    // 记录上游连接被取消的信号：浏览器断开后 fake Agent 应观察到连接关闭。
    let upstreamConnections = 0;
    let upstreamClosed = 0;
    const agentUrl = await listenAgent((request, response) => {
      upstreamConnections += 1;
      request.on("close", () => {
        upstreamClosed += 1;
      });
      response.writeHead(200, { "content-type": "text/event-stream" });
      // 只发首个事件，保持流打开等待客户端断开。
      response.write(
        `id: 1\ndata: ${JSON.stringify(event("run.accepted", 1))}\n\n`,
      );
    });
    const apiUrl = await startApi(agentUrl);

    const controller = new AbortController();
    const response = await fetch(`${apiUrl}/api/chat/runs/run-1/events`, {
      signal: controller.signal,
    });
    await collectSse(response, (list) => list.length >= 1);
    controller.abort();

    // 等待上游连接被释放（API abort 上游 fetch）。
    const deadline = Date.now() + 2_000;
    while (upstreamClosed < upstreamConnections && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(upstreamClosed).toBe(upstreamConnections);
  });
});

describe("公开错误映射不泄露内部信息", () => {
  it("错误响应不包含堆栈与 prompt", async () => {
    const agentUrl = await listenAgent((_request, response) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end("not-json");
    });
    const apiUrl = await startApi(agentUrl);

    const response = await fetch(`${apiUrl}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "s",
        runId: "r",
        message: "你好",
      }),
    });
    const text = await response.text();
    expect(text).not.toMatch(/stack|at .*\(/i);
    expect(text).not.toContain("你好");
  });
});
