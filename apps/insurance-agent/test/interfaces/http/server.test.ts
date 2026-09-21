import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createAgentHttpServer,
  type AgentServiceState,
} from "../../../src/interfaces/http/server.js";
import {
  buildConfig,
  createRecordingLogger,
  createRegistryHarness,
  hanging,
  type RegistryHarness,
} from "../../support/agent_fixtures.js";
import type { AgentRunLogger } from "../../../src/runtime/run_registry.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** 就绪状态替身。 */
function readyState(): AgentServiceState {
  return { ready: true, reasons: [], warnings: [] };
}

/** 装配测试用 HTTP 服务并登记，以便用例结束后关闭。 */
function start(
  harness: RegistryHarness,
  state: AgentServiceState = readyState(),
  config = buildConfig(),
  logger?: AgentRunLogger,
): FastifyInstance {
  const server = createAgentHttpServer({
    config,
    registry: harness.registry,
    state,
    ...(logger === undefined ? {} : { logger }),
  });
  servers.push(server);
  return server;
}

const validRun = {
  sessionId: "session-1",
  runId: "run-1",
  message: "帮我看看续保方案",
};

describe("健康检查", () => {
  it("liveness 返回服务存活与 Agent 名称", async () => {
    const server = start(createRegistryHarness());

    const response = await server.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      agentName: "insurance-agent",
    });
  });

  it("readiness 就绪时返回 200", async () => {
    const server = start(createRegistryHarness());

    const response = await server.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ready",
      agentName: "insurance-agent",
      model: { provider: "opencode-go", id: "deepseek-flash" },
      reasons: [],
    });
  });

  it("模型不可用时 readiness 返回 503 与原因", async () => {
    const server = start(createRegistryHarness(), {
      ready: false,
      reasons: ["MODEL_UNAVAILABLE"],
      warnings: ["模型目录刷新失败或超时"],
    });

    const response = await server.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not-ready",
      reasons: ["MODEL_UNAVAILABLE"],
    });
  });
});

describe("run 创建与停止", () => {
  it("接受 run 时返回 202 与快照", async () => {
    const server = start(createRegistryHarness({ promptImpl: hanging }));

    const response = await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: validRun,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      agentName: "insurance-agent",
      sessionId: "session-1",
      runId: "run-1",
      status: "accepted",
    });
  });

  it("重复提交相同 runId 返回 200 且不重复执行", async () => {
    const harness = createRegistryHarness({ promptImpl: hanging });
    const server = start(harness);

    await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: validRun,
    });
    const response = await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: { ...validRun, message: "第二次提交" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ runId: "run-1" });
    expect(harness.sessions).toHaveLength(1);
  });

  it("达到并发上限时返回 503、稳定错误码与 retry-after", async () => {
    const harness = createRegistryHarness({
      runtime: { maxConcurrentRuns: 1 },
      promptImpl: hanging,
    });
    const server = start(harness);
    await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: validRun,
    });

    const response = await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: { ...validRun, runId: "run-2" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.json()).toEqual({
      error: {
        code: "CAPACITY_EXCEEDED",
        message: "当前无法接受新的 run",
        retryable: true,
      },
    });
  });

  it("未就绪时拒绝创建 run", async () => {
    const server = start(createRegistryHarness(), {
      ready: false,
      reasons: ["CONFIG_INVALID"],
      warnings: [],
    });

    const response = await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: validRun,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: "SERVICE_NOT_READY", retryable: true },
    });
  });

  it("非法请求体返回 400 且不回显输入内容", async () => {
    const server = start(createRegistryHarness());

    const response = await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: { sessionId: "session-1", runId: "run-1", message: "   " },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST", retryable: false },
    });
    expect(response.body).not.toContain("   ");
  });

  it("超长 message 被拒绝", async () => {
    const server = start(createRegistryHarness());

    const response = await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: { ...validRun, message: "很".repeat(40_000) },
    });

    expect(response.statusCode).toBe(400);
  });

  it("停止活动 run 返回 200 快照，重复停止保持幂等", async () => {
    const server = start(createRegistryHarness({ promptImpl: hanging }));
    await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: validRun,
    });

    const first = await server.inject({
      method: "POST",
      url: "/internal/agent/runs/run-1/abort",
    });
    const second = await server.inject({
      method: "POST",
      url: "/internal/agent/runs/run-1/abort",
    });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      snapshot: { status: "aborted", abortReason: "requested" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it("停止不存在的 run 返回 404 稳定错误码", async () => {
    const server = start(createRegistryHarness());

    const response = await server.inject({
      method: "POST",
      url: "/internal/agent/runs/missing/abort",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "RUN_NOT_FOUND" } });
  });

  it("订阅不存在的 run 返回 404", async () => {
    const server = start(createRegistryHarness());

    const response = await server.inject({
      method: "GET",
      url: "/internal/agent/runs/missing/events",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "RUN_NOT_FOUND" } });
  });
});

describe("运行日志", () => {
  it("校验失败与 run 不存在都留下告警日志", async () => {
    const logger = createRecordingLogger();
    const server = start(
      createRegistryHarness(),
      readyState(),
      buildConfig(),
      logger,
    );

    await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: { sessionId: "session-1", runId: "run-1", message: "   " },
    });
    await server.inject({
      method: "POST",
      url: "/internal/agent/runs/missing/abort",
    });
    await server.inject({
      method: "GET",
      url: "/internal/agent/runs/missing/events",
    });

    expect(logger.entries).toMatchObject([
      {
        level: "warn",
        event: "http.run-create-rejected",
        detail: { reason: "invalid-request" },
      },
      { level: "warn", event: "http.run-abort-not-found" },
      { level: "warn", event: "http.run-events-not-found" },
    ]);
  });

  it("未就绪时创建 run 记录 service-not-ready 原因", async () => {
    const logger = createRecordingLogger();
    const server = start(
      createRegistryHarness(),
      { ready: false, reasons: ["MODEL_UNAVAILABLE"], warnings: [] },
      buildConfig(),
      logger,
    );

    await server.inject({
      method: "POST",
      url: "/internal/agent/runs",
      payload: validRun,
    });

    expect(logger.entries[0]).toMatchObject({
      level: "warn",
      event: "http.run-create-rejected",
      detail: { reason: "service-not-ready" },
    });
  });
});
