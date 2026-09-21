import type { FastifyInstance } from "fastify";
import type { ChatLogger } from "../../application/logger.js";
import { registerRunRoutes } from "./run_routes.js";
import { registerSessionRoutes } from "./session_routes.js";

export interface ConversationRoutesOptions {
 readonly runCoordinator: Parameters<
  typeof registerRunRoutes
 >[1]["coordinator"];
 readonly sessions: Parameters<typeof registerSessionRoutes>[1]["sessions"];
 readonly logger?: ChatLogger;
}

/**
 * Conversation HTTP 统一入口。
 *
 * 具体路由按资源拆分，但业务模块只通过这个入口注册 HTTP 接口，避免 bootstrap
 * 直接依赖模块内部的多个 route 文件。
 */
export function registerConversationRoutes(
 server: FastifyInstance,
 options: ConversationRoutesOptions,
): void {
 const logger = options.logger;
 registerSessionRoutes(server, {
  sessions: options.sessions,
  ...(logger === undefined ? {} : { logger }),
 });
 registerRunRoutes(server, {
  coordinator: options.runCoordinator,
  ...(logger === undefined ? {} : { logger }),
 });
}
