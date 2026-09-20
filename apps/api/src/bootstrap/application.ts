import Fastify, { type FastifyInstance } from "fastify";
import type { ChatLogger } from "../application/chat/chat-logger.js";
import {
  ChatRunCoordinator,
  type ChatRunAgentClient,
} from "../application/chat/chat-run-coordinator.js";
import { ChatSessionService } from "../application/chat/chat-session-service.js";
import type { ChatSessionStore } from "../application/chat/chat-session-store.js";
import { loadApiConfig, type ApiConfig } from "../config/api-config.js";
import {
  loadDatabaseConfig,
  type DatabaseConfig,
} from "../config/database-config.js";
import { AgentServiceClient } from "../infrastructure/agent/agent-service-client.js";
import {
  createMySqlDatabase,
  type MySqlDatabase,
} from "../infrastructure/database/mysql-database.js";
import { createJsonLineChatLogger } from "../infrastructure/observability/json-line-chat-logger.js";
import { InMemoryChatSessionStore } from "../infrastructure/persistence/in-memory-chat-session-store.js";
import { registerChatRoutes } from "../interfaces/http/chat-routes.js";
import { registerChatSessionRoutes } from "../interfaces/http/chat-session-routes.js";
import { registerHealthRoutes } from "../interfaces/http/health-routes.js";

/**
 * 业务 API 组合根：装配配置、数据库基础设施、会话仓储、会话应用服务、
 * run 协调器与公开路由。
 *
 * 会话数据当前仍保存在进程内（`InMemoryChatSessionStore`），API 重启后历史清空；
 * 本 change 只接入 MySQL 连接与就绪检查，不把业务数据迁移到数据库。仓储与数据库
 * 都以接口注入，测试可以替换为替身。
 */

export interface ApiAppOptions {
  readonly config?: ApiConfig;
  /** 数据库连接配置；仅在未注入 `database` 替身时读取。 */
  readonly databaseConfig?: DatabaseConfig;
  /** 测试注入的数据库替身；缺省时按配置创建真实 MySQL 基础设施。 */
  readonly database?: MySqlDatabase;
  /** 测试注入的 Agent client 替身；缺省时按配置构造真实 typed client。 */
  readonly agentClient?: ChatRunAgentClient;
  /** 测试注入的会话仓储替身；缺省时使用进程内实现。 */
  readonly sessionStore?: ChatSessionStore;
  /** 结构化日志器；缺省时输出 JSON 行。 */
  readonly logger?: ChatLogger;
}

export interface ApiApp {
  readonly config: ApiConfig;
  readonly database: MySqlDatabase;
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

  // 注入替身时完全跳过真实数据库：测试不需要提供 DATABASE_URL，也不会建立连接。
  // 缺省路径会读取并严格校验配置，配置非法或 CA 证书不可读时在建服务前失败。
  const database =
    options.database ??
    createMySqlDatabase(options.databaseConfig ?? loadDatabaseConfig());

  const sessionStore = options.sessionStore ?? new InMemoryChatSessionStore();
  const sessions = new ChatSessionService({ store: sessionStore });
  const coordinator = new ChatRunCoordinator({
    sessions,
    agentClient,
    logger,
  });

  // 存活探针不访问数据库：数据库故障只应影响就绪，不应触发进程重启。
  registerHealthRoutes(server, { database, logger });
  registerChatSessionRoutes(server, { sessions, logger });
  registerChatRoutes(server, { coordinator, logger });

  let closed = false;
  return {
    config,
    database,
    server,
    listen: () => server.listen({ host: config.host, port: config.port }),
    close: async () => {
      if (closed) return;
      closed = true;
      // 先停止接受新 run 并等待活动 run 收敛，再关闭 HTTP 服务，最后归还数据库
      // 连接池：顺序反了会让正在执行的查询随连接池一起被强制中断。
      await coordinator.close();
      await server.close();
      await database.close();
    },
  };
}
