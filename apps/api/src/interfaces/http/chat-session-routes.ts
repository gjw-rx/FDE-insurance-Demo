import type { FastifyInstance } from "fastify";
import type { ChatLogger } from "../../application/chat/chat-logger.js";
import { silentChatLogger } from "../../application/chat/chat-logger.js";
import type { ChatSessionService } from "../../application/chat/chat-session-service.js";
import { toChatErrorResponse } from "./chat-http-errors.js";

/**
 * 会话资源路由。
 *
 * 只做协议适配：解析路径与查询参数、调用会话应用服务、把稳定错误映射为 JSON。
 * 不缓存会话、不解释消息内容，也不把标题或消息正文写入日志。
 */

export interface ChatSessionRoutesOptions {
  readonly sessions: ChatSessionService;
  readonly logger?: ChatLogger;
}

/** 读取路径参数中的 sessionId。 */
function readSessionId(params: unknown): string {
  const value = (params as { sessionId?: unknown } | null)?.sessionId;
  return typeof value === "string" ? value : "";
}

export function registerChatSessionRoutes(
  server: FastifyInstance,
  options: ChatSessionRoutesOptions,
): void {
  const { sessions } = options;
  const logger = options.logger ?? silentChatLogger;

  server.post("/api/chat/sessions", async (_request, reply) => {
    try {
      const result = await sessions.createSession();
      logger.info("chat.session.created", {
        sessionId: result.session.sessionId,
      });
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = toChatErrorResponse(error);
      logger.warn("chat.session.create-failed", { code: mapped.code });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.get("/api/chat/sessions", async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    try {
      const result = await sessions.listSessions({
        limit: query["limit"],
        cursor: query["cursor"],
      });
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = toChatErrorResponse(error);
      logger.warn("chat.session.list-failed", { code: mapped.code });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.get("/api/chat/sessions/:sessionId", async (request, reply) => {
    const sessionId = readSessionId(request.params);
    try {
      const result = await sessions.getSessionDetail(sessionId);
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = toChatErrorResponse(error);
      logger.warn("chat.session.detail-failed", { code: mapped.code });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });

  server.patch("/api/chat/sessions/:sessionId", async (request, reply) => {
    const sessionId = readSessionId(request.params);
    try {
      const result = await sessions.renameSession(sessionId, request.body);
      logger.info("chat.session.renamed", {
        sessionId: result.session.sessionId,
      });
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = toChatErrorResponse(error);
      logger.warn("chat.session.rename-failed", { code: mapped.code });
      return reply.code(mapped.statusCode).send(mapped.body);
    }
  });
}
