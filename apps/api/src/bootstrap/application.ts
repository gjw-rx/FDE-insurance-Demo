import Fastify, { type FastifyInstance } from "fastify";
import type { ChatLogger } from "../application/chat/chat-logger.js";
import {
  ChatRunCoordinator,
  type ChatRunAgentClient,
} from "../application/chat/chat-run-coordinator.js";
import { ChatSessionService } from "../application/chat/chat-session-service.js";
import type { ChatSessionStore } from "../application/chat/chat-session-store.js";
import { loadApiConfig, type ApiConfig } from "../config/api-config.js";
import { AgentServiceClient } from "../infrastructure/agent/agent-service-client.js";
import { createJsonLineChatLogger } from "../infrastructure/observability/json-line-chat-logger.js";
import { InMemoryChatSessionStore } from "../infrastructure/persistence/in-memory-chat-session-store.js";
import { registerChatRoutes } from "../interfaces/http/chat-routes.js";
import { registerChatSessionRoutes } from "../interfaces/http/chat-session-routes.js";

/**
 * 业务 API 组合根：装配配置、会话仓储、会话应用服务、run 协调器与公开路由。
 *
 * 会话数据当前保存在进程内（`InMemoryChatSessionStore`），API 重启后历史清空；
 * 仓储以接口注入，后续替换为文件或数据库实现时只改这里。测试可注入替身
 * 仓储、替身 Agent client 与日志器。
 */

export interface ApiAppOptions {
  readonly config?: ApiConfig;
  /** 测试注入的 Agent client 替身；缺省时按配置构造真实 typed client。 */
  readonly agentClient?: ChatRunAgentClient;
  /** 测试注入的会话仓储替身；缺省时使用进程内实现。 */
  readonly sessionStore?: ChatSessionStore;
  /** 结构化日志器；缺省时输出 JSON 行。 */
  readonly logger?: ChatLogger;
}

export interface ApiApp {
  readonly config: ApiConfig;
  readonly server: FastifyInstance;
  listen(): Promise<string>;
  close(): Promise<void>;
}

/** 创建 Fastify 应用实例；不监听端口，由调用方决定生命周期。 */
export function createApiApp(options: ApiAppOptions = {}): ApiApp {
  const config = options.config ?? loadApiConfig();
  const server = Fastify({ logger: false });
  const logger = options.logger ?? createJsonLineChatLogger();

  const agentClient =
    options.agentClient ??
    new AgentServiceClient({
      baseUrl: config.agentBaseUrl,
      connectTimeoutMs: config.agentConnectTimeoutMs,
      responseTimeoutMs: config.agentResponseTimeoutMs,
    });

  const sessionStore = options.sessionStore ?? new InMemoryChatSessionStore();
  const sessions = new ChatSessionService({ store: sessionStore });
  const coordinator = new ChatRunCoordinator({
    sessions,
    agentClient,
    logger,
  });

  server.get("/health/live", async () => ({ status: "ok" as const }));

  registerChatSessionRoutes(server, { sessions, logger });
  registerChatRoutes(server, { coordinator, logger });

  let closed = false;
  return {
    config,
    server,
    listen: () => server.listen({ host: config.host, port: config.port }),
    close: async () => {
      if (closed) return;
      closed = true;
      // 先停止接受新 run 并等待活动 run 收敛，再关闭 HTTP 服务，
      // 这样已订阅的 SSE 能收到终态而不是被连接中断。
      await coordinator.close();
      await server.close();
    },
  };
}
