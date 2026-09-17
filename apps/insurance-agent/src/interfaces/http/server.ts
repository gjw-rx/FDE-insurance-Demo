import Fastify, { type FastifyInstance } from "fastify";
import type {
  AgentErrorResponse,
  AgentNotReadyReason,
  AgentRunEvent,
  AgentRunTerminalEventType,
  AgentServiceErrorCode,
} from "@renewal/contracts/agent";
import type { AgentConfig } from "../../config/agent-config.js";
import type {
  AgentRunCreateInput,
  AgentRunLogger,
  AgentRunRegistry,
} from "../../runtime/run-registry.js";

/**
 * 内部 HTTP/SSE 契约。
 *
 * 该服务只面向业务 API（`apps/api`），不面向浏览器：对外鉴权、业务会话和错误转换
 * 仍由业务 API 负责。响应与事件都使用 contracts 中的稳定错误码，且不包含 prompt、
 * thinking、文件内容、工具原始参数/结果或凭据。
 */

const MAX_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 32_000;
/** 慢消费者允许的最大未 drain 次数，超过后断开连接。 */
const MAX_WRITE_BACKLOG = 64;

/** SSE 结束原因，用于运行日志区分正常终态、客户端断开与慢消费者。 */
type SseCloseReason = "terminal" | "client-disconnect" | "slow-consumer";

export interface AgentServiceState {
  readonly ready: boolean;
  readonly reasons: readonly AgentNotReadyReason[];
  readonly warnings: readonly string[];
}

export interface AgentHttpServerOptions {
  readonly config: AgentConfig;
  readonly registry: AgentRunRegistry;
  readonly state: AgentServiceState;
  /** 运行日志；只记录拒绝原因与连接生命周期，不记录 prompt 或回答正文。 */
  readonly logger?: AgentRunLogger;
}

/** 统一错误响应体；只暴露稳定错误码、脱敏消息与是否可重试。 */
function errorBody(
  code: AgentServiceErrorCode,
  message: string,
  retryable: boolean,
): AgentErrorResponse {
  return { error: { code, message, retryable } };
}

/** 非空（去空白后仍有内容）字符串类型守卫。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 校验并规范化创建 run 的请求体；失败消息不回显输入内容。 */
function readRunCreateInput(
  body: unknown,
):
  | { readonly ok: true; readonly value: AgentRunCreateInput }
  | { readonly ok: false; readonly message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "请求体必须是对象" };
  }

  const record = body as Record<string, unknown>;
  const sessionId = record["sessionId"];
  const runId = record["runId"];
  const message = record["message"];

  if (!isNonEmptyString(sessionId) || sessionId.length > MAX_ID_LENGTH) {
    return {
      ok: false,
      message: `sessionId 必须是 1-${MAX_ID_LENGTH} 字符的非空字符串`,
    };
  }
  if (!isNonEmptyString(runId) || runId.length > MAX_ID_LENGTH) {
    return {
      ok: false,
      message: `runId 必须是 1-${MAX_ID_LENGTH} 字符的非空字符串`,
    };
  }
  if (!isNonEmptyString(message) || message.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      message: `message 必须是 1-${MAX_MESSAGE_LENGTH} 字符的非空字符串`,
    };
  }

  return { ok: true, value: { sessionId, runId, message } };
}

/** 解析续接 cursor：接受非负整数或十进制字符串，其他输入返回 undefined。 */
function parseCursor(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0)
    return value;
  if (typeof value === "string" && /^\d+$/.test(value))
    return Number.parseInt(value, 10);
  return undefined;
}

/**
 * 创建内部 HTTP 服务：health 探针、run 创建/停止与 SSE 事件流。
 * 输入校验、稳定状态码与脱敏错误都在这一层收敛。
 */
export function createAgentHttpServer(
  options: AgentHttpServerOptions,
): FastifyInstance {
  const { config, registry, state, logger } = options;
  const server = Fastify({ logger: false });

  server.get("/health/live", async () => ({
    status: "ok" as const,
    agentName: config.agentName,
  }));

  server.get("/health/ready", async (_request, reply) => {
    const body = {
      status: state.ready ? ("ready" as const) : ("not-ready" as const),
      agentName: config.agentName,
      model: { provider: config.model.provider, id: config.model.id },
      reasons: state.ready ? [] : [...state.reasons],
    };
    return reply.code(state.ready ? 200 : 503).send(body);
  });

  server.post("/internal/agent/runs", async (request, reply) => {
    const input = readRunCreateInput(request.body);
    if (!input.ok) {
      // 不记录请求体或错误消息，避免回显调用方输入。
      logger?.warn("http.run-create-rejected", { reason: "invalid-request" });
      return reply
        .code(400)
        .send(errorBody("INVALID_REQUEST", input.message, false));
    }

    if (!state.ready) {
      logger?.warn("http.run-create-rejected", { reason: "service-not-ready" });
      return reply
        .code(503)
        .send(errorBody("SERVICE_NOT_READY", "Agent 服务尚未就绪", true));
    }

    const outcome = await registry.create(input.value);
    if (outcome.kind === "rejected") {
      if (outcome.code === "CAPACITY_EXCEEDED") {
        reply.header("retry-after", "1");
      }
      return reply
        .code(503)
        .send(
          errorBody(outcome.code, "当前无法接受新的 run", outcome.retryable),
        );
    }

    return reply
      .code(outcome.kind === "accepted" ? 202 : 200)
      .send(outcome.snapshot);
  });

  server.post("/internal/agent/runs/:runId/abort", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const outcome = await registry.abort(runId, "requested");

    if (outcome.kind === "not-found") {
      logger?.warn("http.run-abort-not-found", { runId });
      return reply
        .code(404)
        .send(errorBody("RUN_NOT_FOUND", "指定的 run 不存在", false));
    }

    return reply.code(200).send({ snapshot: outcome.snapshot });
  });

  server.get("/internal/agent/runs/:runId/events", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const query = request.query as Record<string, unknown>;
    const after =
      parseCursor(query["after"]) ??
      parseCursor(request.headers["last-event-id"]) ??
      0;

    const history = registry.eventsSince(runId, after);
    if (history === undefined) {
      logger?.warn("http.run-events-not-found", { runId });
      return reply
        .code(404)
        .send(errorBody("RUN_NOT_FOUND", "指定的 run 不存在", false));
    }
    if (after > 0 && after < history.earliestCursor - 1) {
      logger?.warn("http.event-cursor-expired", { runId, after });
      return reply
        .code(409)
        .send(
          errorBody(
            "EVENT_CURSOR_EXPIRED",
            "订阅起点早于服务保留的事件范围",
            false,
          ),
        );
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    let lastSentCursor = after;
    let backlog = 0;
    let closed = false;
    logger?.info("sse.subscribed", { runId, after });

    // 幂等收尾：释放订阅并结束响应；终态、慢消费者超限与客户端断开都走这里。
    const finish = (reason: SseCloseReason): void => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end();
      if (reason === "slow-consumer") {
        logger?.warn("sse.slow-consumer", { runId });
      }
      logger?.info("sse.closed", { runId, reason });
    };

    // 按 cursor 去重后写入；写回压超限直接断开，由调用方携 cursor 重连。
    const send = (event: AgentRunEvent): void => {
      if (closed || event.cursor <= lastSentCursor) return;
      lastSentCursor = event.cursor;

      const written = reply.raw.write(
        `id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`,
      );
      if (written) {
        backlog = 0;
      } else {
        backlog += 1;
        // 慢消费者：有界积压，超限断开，由调用方携带 cursor 重连。
        if (backlog > MAX_WRITE_BACKLOG) finish("slow-consumer");
      }

      if (isTerminalEvent(event)) finish("terminal");
    };

    const unsubscribe = registry.subscribe(runId, send);
    for (const event of history.events) send(event);

    if (registry.isTerminal(runId) && !closed) finish("terminal");

    // 连接断开只释放订阅，不停止 run。
    reply.raw.on("close", () => finish("client-disconnect"));

    return reply;
  });

  return server;
}

/** 终态事件集合从契约类型派生，避免与 contracts 漂移。 */
const TERMINAL_EVENT_TYPES: readonly AgentRunTerminalEventType[] = [
  "run.completed",
  "run.failed",
  "run.aborted",
];

/** 是否为终态事件；终态事件发出后立即结束 SSE 流。 */
function isTerminalEvent(event: AgentRunEvent): boolean {
  return TERMINAL_EVENT_TYPES.includes(event.type as AgentRunTerminalEventType);
}
