import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentClientError,
  AgentServiceClient,
} from "../../../../../src/modules/conversation/infrastructure/agent/agent_service_client.js";

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

/** 启动临时 HTTP 服务并返回 baseUrl，用例结束后统一关闭。 */
async function listen(handler: Handler): Promise<string> {
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
    throw new Error("测试服务未返回监听端口");
  }
  return `http://127.0.0.1:${address.port}`;
}

/** 发送 JSON 响应。 */
function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

/** 构造使用短超时的待测客户端。 */
function client(baseUrl: string, responseTimeoutMs = 500): AgentServiceClient {
  return new AgentServiceClient({
    baseUrl,
    connectTimeoutMs: 500,
    responseTimeoutMs,
  });
}

const snapshot = {
  agentName: "insurance-agent",
  sessionId: "session-1",
  runId: "run-1",
  status: "accepted" as const,
  createdAt: "2026-09-15T00:00:00.000Z",
};

describe("AgentServiceClient", () => {
  it("通过统一契约创建与停止 run", async () => {
    const requests: string[] = [];
    const baseUrl = await listen(async (request, response) => {
      requests.push(`${request.method} ${request.url}`);
      if (request.url?.endsWith("/abort")) {
        json(response, 200, {
          snapshot: {
            ...snapshot,
            status: "aborted",
            abortReason: "requested",
          },
        });
        return;
      }
      for await (const _chunk of request) {
        // 消费请求体后再返回，模拟真实内部服务。
      }
      json(response, 202, snapshot);
    });
    const service = client(baseUrl);

    await expect(
      service.createRun({
        sessionId: "session-1",
        runId: "run-1",
        message: "你好",
      }),
    ).resolves.toEqual(snapshot);
    await expect(service.abortRun("run-1")).resolves.toMatchObject({
      snapshot: { status: "aborted", abortReason: "requested" },
    });
    expect(requests).toEqual([
      "POST /internal/agent/runs",
      "POST /internal/agent/runs/run-1/abort",
    ]);
  });

  it("解析 SSE 事件并携带续接 cursor", async () => {
    let requestUrl = "";
    let lastEventId = "";
    const baseUrl = await listen((request, response) => {
      requestUrl = request.url ?? "";
      lastEventId = String(request.headers["last-event-id"] ?? "");
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `id: 3\ndata: ${JSON.stringify({
          ...snapshot,
          type: "run.completed",
          cursor: 3,
          at: "2026-09-15T00:00:01.000Z",
        })}\n\n`,
      );
    });

    const events = [];
    for await (const event of client(baseUrl).streamEvents("run-1", {
      after: 2,
    })) {
      events.push(event);
    }

    expect(requestUrl).toBe("/internal/agent/runs/run-1/events?after=2");
    expect(lastEventId).toBe("2");
    expect(events).toMatchObject([{ type: "run.completed", cursor: 3 }]);
  });

  it("把服务错误映射为带稳定错误码的 client error", async () => {
    const baseUrl = await listen((_request, response) => {
      json(response, 503, {
        error: {
          code: "CAPACITY_EXCEEDED",
          message: "当前无法接受新的 run",
          retryable: true,
        },
      });
    });

    const error = await client(baseUrl)
      .createRun({ sessionId: "s", runId: "r", message: "m" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AgentClientError);
    expect(error).toMatchObject({
      kind: "service",
      statusCode: 503,
      serviceError: { code: "CAPACITY_EXCEEDED", retryable: true },
    });
  });

  it("连接失败时返回 connection 错误", async () => {
    const baseUrl = await listen((_request, response) => {
      response.end();
    });
    await cleanup.pop()?.();

    await expect(
      client(baseUrl).createRun({ sessionId: "s", runId: "r", message: "m" }),
    ).rejects.toMatchObject({ kind: "connection" });
  });

  it("等待响应超过配置上限时返回 timeout 错误", async () => {
    const baseUrl = await listen((_request, response) => {
      // 保持连接打开，直到 client 超时并主动中断。
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
    });

    await expect(
      client(baseUrl, 20).createRun({
        sessionId: "s",
        runId: "r",
        message: "m",
      }),
    ).rejects.toMatchObject({ kind: "timeout" });
  });

  it("非法 JSON 被映射为 protocol 错误", async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(202, { "content-type": "application/json" });
      response.end("not-json");
    });

    await expect(
      client(baseUrl).createRun({ sessionId: "s", runId: "r", message: "m" }),
    ).rejects.toMatchObject({ kind: "protocol" });
  });

  it("baseUrl 非法时在构造阶段就拒绝", () => {
    expect(
      () =>
        new AgentServiceClient({
          baseUrl: "not-a-url",
          connectTimeoutMs: 100,
          responseTimeoutMs: 100,
        }),
    ).toThrow(AgentClientError);
  });
});
