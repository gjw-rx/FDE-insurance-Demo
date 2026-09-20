import type { FastifyInstance } from "fastify";
import type {
  AgentRunEvent,
  AgentRunTerminalEventType,
} from "@renewal/contracts/agent";
import type { ChatApiErrorCode } from "@renewal/contracts";
import type { ChatLogger } from "../../application/chat/chat-logger.js";
import { silentChatLogger } from "../../application/chat/chat-logger.js";
import type {
  ChatRunCoordinator,
  ChatRunSubscription,
} from "../../application/chat/chat-run-coordinator.js";
import { chatErrorBody, toChatErrorResponse } from "./chat-http-errors.js";

/**
 * 面向浏览器的对话 run 接口。
 *
 * 该层只做协议适配：校验公开请求、调用 run 协调器、把协调器事件编码为稳定 SSE。
 * 会话与消息的保存、Agent 事件消费都由协调器负责，因此浏览器断开不会中断
 * Agent run（见 change design.md D6）。
 */

const MAX_ID_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 32_000;
/** 终态事件集合从契约类型派生，避免与 contracts 漂移。 */
const TERMINAL_EVENT_TYPES: readonly AgentRunTerminalEventType[] = [
  "run.completed",
  "run.failed",
  "run.aborted",
];

/** 创建 run 的公开请求体（与 contracts 的 AgentRunCreateRequest 一致）。 */
interface AgentChatCreateBody {
  readonly sessionId: string;
  readonly runId: string;
  readonly message: string;
}

/** 非空（去空白后仍有内容）字符串类型守卫。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

/** SSE 输出端：与 Fastify 的 `reply.raw` 结构兼容的最小接口。 */
interface SseSink {
  write(chunk: string, callback: (error?: Error | null) => void): boolean;
}

/** 写入一个 SSE 帧并等待底层写入完成。 */
function writeFrame(raw: SseSink, payload: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (
      raw.write(payload, (error) => {
        if (error === undefined || error === null) resolve();
        else reject(error);
      })
    ) {
      resolve();
    }
  });
}

export interface ChatRoutesOptions {
  /** run 协调器：负责 Agent 调用、会话写入与事件广播。 */
  readonly coordinator: ChatRunCoordinator;
  readonly logger?: ChatLogger;
}

/** 注册公开对话路由：POST /api/chat/runs 与 GET /api/chat/runs/:runId/events。 */
export function registerChatRoutes(
  server: FastifyInstance,
  options: ChatRoutesOptions,
): void {
  const { coordinator } = options;
  const logger = options.logger ?? silentChatLogger;

  server.post("/api/chat/runs", async (request, reply) => {
    const input = readCreateRequest(request.body);
    if (!input.ok) {
      logger.warn("chat.run.rejected", { code: "INVALID_REQUEST" });
      return reply
        .code(400)
        .send(chatErrorBody("INVALID_REQUEST", input.message, false));
    }

    try {
      const snapshot = await coordinator.startRun(input.value);
      return reply.code(202).send(snapshot);
    } catch (error) {
      const mapped = toChatErrorResponse(error);
      logger.warn("chat.run.create-failed", { code: mapped.code });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.get("/api/chat/runs/:runId/events", async (request, reply) => {
    const { runId } = request.params as { runId: string };

    let subscription: ChatRunSubscription;
    try {
      subscription = coordinator.subscribe(runId);
    } catch (error) {
      const mapped = toChatErrorResponse(error);
      return reply.code(mapped.statusCode).send(mapped.body);
    }

    // 浏览器断开只解除本次订阅；协调器继续消费并保存该 run 的后续事件。
    const onClose = (): void => subscription.close();
    reply.raw.on("close", onClose);

    try {
      // 立即消费首个事件：上游未产出任何事件就结束（例如 Agent 不可达）时
      // 在写出响应头之前转为 JSON 错误。
      const first = await subscription.next();
      if (first === null) {
        // 空流说明 run 已按失败收敛（或服务正在关闭）：优先回放 Agent 的稳定
        // 拒绝码；否则按不可重试的故障返回——重试该流不会再有结果。
        const rejection = coordinator.getUpstreamRejection(runId);
        if (rejection !== undefined) {
          return reply
            .code(rejection.statusCode ?? 503)
            .send(
              chatErrorBody(
                rejection.code as ChatApiErrorCode,
                "Agent 服务拒绝了该请求",
                rejection.retryable,
              ),
            );
        }
        return reply
          .code(503)
          .send(chatErrorBody("SERVICE_NOT_READY", "服务暂时不可用", false));
      }

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });

      let current: AgentRunEvent | null = first;
      while (current !== null) {
        await writeFrame(
          reply.raw,
          `id: ${current.cursor}\ndata: ${JSON.stringify(current)}\n\n`,
        );
        if (isTerminalEvent(current)) break;
        current = await subscription.next();
      }
      reply.raw.end();
      return undefined;
    } catch {
      // 响应头已写出时只能直接结束，避免把内部错误写入事件流。
      if (!reply.raw.headersSent) {
        return reply
          .code(503)
          .send(chatErrorBody("SERVICE_NOT_READY", "服务暂时不可用", true));
      }
      reply.raw.end();
      return undefined;
    } finally {
      subscription.close();
      reply.raw.off("close", onClose);
      logger.info("chat.sse.closed", { runId });
    }
  });
}
