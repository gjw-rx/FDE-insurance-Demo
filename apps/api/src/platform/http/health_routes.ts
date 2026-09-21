import type { FastifyInstance } from "fastify";
import type {
  ApiLiveStatus,
  ApiNotReadyReason,
  ApiReadyStatus,
} from "@renewal/contracts";
import type { ChatLogger } from "../../modules/conversation/application/logger.js";
import { silentChatLogger } from "../../modules/conversation/application/logger.js";
import type {
  DatabaseReadinessFailureReason,
  MySqlDatabase,
} from "../database/mysql_database.js";

/**
 * 健康路由。
 *
 * `/health/live` 只表示进程存活，不访问任何依赖，因此数据库故障不会让进程被
 * 误判为死亡并触发重启。`/health/ready` 执行一次有界数据库往返，表达服务是否
 * 可以接收流量。
 *
 * 就绪响应只包含稳定状态与脱敏原因：不含数据库地址、凭据或驱动错误细节。
 */

export interface HealthRoutesOptions {
  readonly database: MySqlDatabase;
  readonly logger?: ChatLogger;
}

/** 内部失败原因到公开脱敏原因的映射。 */
function toPublicReason(
  reason: DatabaseReadinessFailureReason,
): ApiNotReadyReason {
  return reason === "timeout" ? "DATABASE_TIMEOUT" : "DATABASE_UNREACHABLE";
}

export function registerHealthRoutes(
  server: FastifyInstance,
  options: HealthRoutesOptions,
): void {
  const { database } = options;
  const logger = options.logger ?? silentChatLogger;

  server.get("/health/live", async (): Promise<ApiLiveStatus> => {
    return { status: "ok" };
  });

  server.get("/health/ready", async (_request, reply) => {
    const readiness = await database.checkReadiness();

    if (readiness.ready) {
      const body: ApiReadyStatus = { status: "ready", reasons: [] };
      return reply.code(200).send(body);
    }

    const body: ApiReadyStatus = {
      status: "not-ready",
      reasons: [toPublicReason(readiness.reason)],
    };
    // 只记录稳定原因，不记录连接目标或驱动错误。
    logger.warn("health.ready.not-ready", { reason: readiness.reason });
    return reply.code(503).send(body);
  });
}
