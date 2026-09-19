import type { FastifyInstance } from "fastify";
import type {
  AgentErrorResponse,
  AgentRunEvent,
  AgentRunTerminalEventType,
  AgentServiceErrorCode,
} from "@renewal/contracts/agent";
import {
  AgentClientError,
  type AgentServiceClient,
} from "../../infrastructure/agent/agent-service-client.js";

/**
 * 面向浏览器的公开对话接口。
 *
 * 该层只做协议适配：校验公开请求、转发到 insurance-agent typed client、
 * 把内部 SSE 编码为稳定事件流。不保存消息、不解释回答内容，也不持有
 * 任何密钥；错误只暴露稳定错误码与脱敏文案。
 */

const MAX_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 32_000;
/** 终态事件集合从契约类型派生，避免与 contracts 漂移。 */
const TERMINAL_EVENT_TYPES: readonly AgentRunTerminalEventType[] = [
  "run.completed",
  "run.failed",
  "run.aborted",
];

/** chat 路由依赖的最小接口：AgentServiceClient 及测试替身都满足该形状。 */
export type ChatAgentClient = Pick<
  AgentServiceClient,
  "createRun" | "streamEvents"
>;

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

/** 创建 run 的公开请求体（与 contracts 的 AgentRunCreateRequest 一致）。 */
interface AgentChatCreateBody {
  readonly sessionId: string;
  readonly runId: string;
  readonly message: string;
}

/** 校验创建 run 的公开请求体；失败消息不回显输入内容。 */
function readCreateRequest(
  body: unknown,
):
  | { readonly ok: true; readonly value: AgentChatCreateBody }
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

/** 是否为终态事件；终态事件写出后结束 SSE 流。 */
function isTerminalEvent(event: AgentRunEvent): boolean {
  return TERMINAL_EVENT_TYPES.includes(event.type as AgentRunTerminalEventType);
}

/**
 * 把 AgentClientError 映射为公开错误响应。
 *
 * Agent 服务的稳定错误保留其错误码与 retryable；连接、超时与协议错误
 * 统一映射为可重试的 SERVICE_NOT_READY，不透出内部地址或原始消息。
 */
function toPublicError(error: unknown): {
  readonly statusCode: number;
  readonly body: AgentErrorResponse;
} {
  if (
    error instanceof AgentClientError &&
    error.kind === "service" &&
    error.serviceError !== undefined
  ) {
    return {
      statusCode: error.statusCode ?? 503,
      body: errorBody(
        error.serviceError.code,
        "Agent 服务拒绝了该请求",
        error.serviceError.retryable,
      ),
    };
  }
  return {
    statusCode: 503,
    body: errorBody("SERVICE_NOT_READY", "Agent 服务暂时不可用", true),
  };
}

export interface ChatRoutesOptions {
  /** Agent typed client（或测试替身）。 */
  readonly agentClient: ChatAgentClient;
}

/** 注册公开对话路由：POST /api/chat/runs 与 GET /api/chat/runs/:runId/events。 */
export function registerChatRoutes(
  server: FastifyInstance,
  options: ChatRoutesOptions,
): void {
  const { agentClient } = options;

  server.post("/api/chat/runs", async (request, reply) => {
    const input = readCreateRequest(request.body);
    if (!input.ok) {
      return reply
        .code(400)
        .send(errorBody("INVALID_REQUEST", input.message, false));
    }

    try {
      const snapshot = await agentClient.createRun(input.value);
      return reply.code(202).send(snapshot);
    } catch (error) {
      const { statusCode, body } = toPublicError(error);
      return reply.code(statusCode).send(body);
    }
  });

  server.get("/api/chat/runs/:runId/events", async (request, reply) => {
    const { runId } = request.params as { runId: string };

    // 浏览器断开时取消上游订阅；上游 run 本身不受影响。
    const controller = new AbortController();
    reply.raw.on("close", () => controller.abort());

    // generator 创建本身不执行任何代码，先拿到引用供 finally 收尾。
    const upstream = agentClient.streamEvents(runId, {
      signal: controller.signal,
    });

    try {
      // 立即消费首个事件：上游连接错误在写出响应头之前被发现并转为 JSON 错误。
      let current: IteratorResult<AgentRunEvent, void> = await upstream.next();
      if (current.done) {
        const { statusCode, body } = toPublicError(
          new AgentClientError("protocol", "Agent SSE 没有返回任何事件"),
        );
        return reply.code(statusCode).send(body);
      }

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      while (!current.done) {
        const event = current.value;
        const payload = `id: ${event.cursor}\ndata: ${JSON.stringify(event)}\n\n`;
        await new Promise<void>((resolve, reject) => {
          if (
            reply.raw.write(payload, (error) => {
              if (error === undefined) resolve();
              else reject(error);
            })
          ) {
            resolve();
          }
        });
        if (isTerminalEvent(event)) break;
        current = await upstream.next();
      }
      reply.raw.end();
    } catch (error) {
      // 响应头尚未写出（上游 404/连接失败）时仍可返回 JSON 错误。
      if (!reply.raw.headersSent) {
        const { statusCode, body } = toPublicError(error);
        return reply.code(statusCode).send(body);
      }
      reply.raw.end();
    } finally {
      await upstream.return(undefined).catch(() => undefined);
    }
  });
}
