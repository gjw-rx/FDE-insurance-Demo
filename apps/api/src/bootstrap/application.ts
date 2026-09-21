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
import { MySqlChatSessionStore } from "../infrastructure/persistence/mysql-chat-session-store.js";
import { registerChatRoutes } from "../interfaces/http/chat-routes.js";
import { registerChatSessionRoutes } from "../interfaces/http/chat-session-routes.js";
import { registerHealthRoutes } from "../interfaces/http/health-routes.js";

/**
 * 业务 API 组合根：装配配置、数据库基础设施、会话仓储、会话应用服务、
 * run 协调器与公开路由。
 *
 * 会话数据的生产事实来源是 MySQL（`MySqlChatSessionStore`）：进程重启后历史仍可读取。
 * 数据库句柄、会话仓储、Agent client 与日志器都以接口注入，测试可替换为替身，但
 * **没有内存后备**：注入数据库替身时若未显式注入会话仓储，组合根直接失败，避免把
 * 持久化故障静默降级为写入进程内存。
 *
 * schema migration 不在启动时执行（只由发布流程显式调用 `db:migrate`）；启动阶段只做
 * 一次幂等的恢复检查，收敛上次进程遗留的非终态记录。
 */

export interface ApiAppOptions {
  readonly config?: ApiConfig;
  /** 数据库连接配置；仅在未注入 `database` 替身时读取。 */
  readonly databaseConfig?: DatabaseConfig;
  /** 测试注入的数据库替身；缺省时按配置创建真实 MySQL 基础设施。 */
  readonly database?: MySqlDatabase;
  /** 测试注入的 Agent client 替身；缺省时按配置构造真实 typed client。 */
  readonly agentClient?: ChatRunAgentClient;
  /** 测试注入的会话仓储；缺省时使用 MySQL 实现（注入数据库替身时必须显式提供）。 */
  readonly sessionStore?: ChatSessionStore;
  /** 结构化日志器；缺省时输出 JSON 行。 */
  readonly logger?: ChatLogger;
}

export interface ApiApp {
  readonly config: ApiConfig;
  readonly database: MySqlDatabase;
  readonly server: FastifyInstance;
  /**
   * 启动恢复：收敛上次进程遗留的非终态 run 与 `streaming` 消息，幂等且可重复调用。
   *
   * `listen` 会先执行本方法；单独暴露是为了让测试在不监听端口的情况下验证恢复行为。
   * 恢复失败不阻止进程存活：数据库可用性由 readiness 如实反映，写操作返回脱敏的
   * 可重试错误，且不会因此回退到内存存储。
   */
  recover(): Promise<void>;
  listen(): Promise<string>;
  close(): Promise<void>;
}

/**
 * 解析会话仓储。
 *
 * 注入优先；否则要求真实的数据库查询句柄。缺失句柄说明调用方注入了数据库替身却
 * 没有注入仓储，此时直接报错而不是回退到内存实现。
 */
function resolveSessionStore(
  options: ApiAppOptions,
  database: MySqlDatabase,
): ChatSessionStore {
  if (options.sessionStore !== undefined) return options.sessionStore;

  const db = database.db;
  if (db === undefined) {
    throw new Error(
      "注入数据库替身时必须同时注入 sessionStore：生产路径不会回退到内存仓储",
    );
  }
  return new MySqlChatSessionStore({ db });
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

  const sessionStore = resolveSessionStore(options, database);
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

  let recovered = false;
  const recover = async (): Promise<void> => {
    if (recovered) return;
    try {
      const summary = await sessionStore.recoverInterruptedRuns({
        updatedAt: new Date().toISOString(),
      });
      recovered = true;
      logger.info("chat.recovery.completed", {
        runs: summary.runs,
        messages: summary.messages,
      });
    } catch {
      // 不标记为已恢复，让后续调用可以重试；失败原因只记录稳定事件名，
      // 不输出连接地址、凭据或消息正文。
      logger.warn("chat.recovery.failed");
    }
  };

  let closed = false;
  return {
    config,
    database,
    server,
    recover,
    listen: async () => {
      // 先做恢复检查再对外提供服务，避免重启后旧的非终态记录被当作活动 run 展示。
      await recover();
      return server.listen({ host: config.host, port: config.port });
    },
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
