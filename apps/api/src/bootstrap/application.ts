import Fastify, { type FastifyInstance } from "fastify";
import type { ChatLogger } from "../modules/conversation/application/logger.js";
import type { ChatRunAgentClient } from "../modules/conversation/application/run_coordinator.js";
import type { ChatSessionStore } from "../modules/conversation/application/ports/conversation_repository.js";
import {
  createConversationModule,
  type ConversationModule,
} from "../modules/conversation/conversation_module.js";
import {
  loadApiConfig,
  type ApiConfig,
} from "../platform/config/api_config.js";
import {
  loadDatabaseConfig,
  type DatabaseConfig,
} from "../platform/config/database_config.js";
import { AgentServiceClient } from "../modules/conversation/infrastructure/agent/agent_service_client.js";
import {
  createMySqlDatabase,
  type MySqlDatabase,
} from "../platform/database/mysql_database.js";
import { createJsonLineChatLogger } from "../platform/observability/json_line_logger.js";
import { registerHealthRoutes } from "../platform/http/health_routes.js";

/**
 * 业务 API 组合根。
 *
 * 平台能力在这里创建，业务模块通过模块工厂完成内部装配。bootstrap 不再直接依赖
 * Conversation 内部的仓储实现、应用服务和具体业务路由。
 */
export interface ApiAppOptions {
  readonly config?: ApiConfig;
  /** 数据库连接配置；仅在未注入 `database` 替身时读取。 */
  readonly databaseConfig?: DatabaseConfig;
  /** 测试注入的数据库替身；缺省时按配置创建真实 MySQL 基础设施。 */
  readonly database?: MySqlDatabase;
  /** 测试注入的 Agent client 替身；缺省时按配置构造真实 typed client。 */
  readonly agentClient?: ChatRunAgentClient;
  /** 测试注入的会话仓储；缺省时使用 MySQL 实现。 */
  readonly sessionStore?: ChatSessionStore;
  /** 结构化日志器；缺省时输出 JSON 行。 */
  readonly logger?: ChatLogger;
}

export interface ApiApp {
  readonly config: ApiConfig;
  readonly database: MySqlDatabase;
  readonly server: FastifyInstance;
  recover(): Promise<void>;
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
  const database =
    options.database ??
    createMySqlDatabase(options.databaseConfig ?? loadDatabaseConfig());

  const conversationOptions = {
    agentClient,
    logger,
    ...(database.db === undefined ? {} : { database: database.db }),
    ...(options.sessionStore === undefined
      ? {}
      : { sessionStore: options.sessionStore }),
  };
  const conversation: ConversationModule =
    createConversationModule(conversationOptions);

  // 存活探针不访问数据库：数据库故障只应影响就绪，不应触发进程重启。
  registerHealthRoutes(server, { database, logger });
  conversation.registerRoutes(server);

  let closed = false;
  return {
    config,
    database,
    server,
    recover: conversation.recover,
    listen: async () => {
      // 先做恢复检查再对外提供服务，避免重启后旧的非终态记录被当作活动 run 展示。
      await conversation.recover();
      return server.listen({ host: config.host, port: config.port });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      // 先停止活动 run，再关闭 HTTP 服务，最后归还数据库连接池。
      await conversation.close();
      await server.close();
      await database.close();
    },
  };
}
