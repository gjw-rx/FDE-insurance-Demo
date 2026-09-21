import type { FastifyInstance } from "fastify";
import type { ChatLogger } from "./application/logger.js";
import {
  ChatRunCoordinator,
  type ChatRunAgentClient,
} from "./application/run_coordinator.js";
import { ChatSessionService } from "./application/session_service.js";
import type { ChatSessionStore } from "./application/ports/conversation_repository.js";
import {
  MySqlChatSessionStore,
  type MySqlChatSessionStoreOptions,
} from "./infrastructure/persistence/mysql/mysql_conversation_repository.js";
import { registerConversationRoutes } from "./interfaces/http/conversation_routes.js";

export interface ConversationModuleOptions {
  readonly database?: MySqlChatSessionStoreOptions["db"];
  readonly agentClient: ChatRunAgentClient;
  readonly sessionStore?: ChatSessionStore;
  readonly logger: ChatLogger;
}

export interface ConversationModule {
  readonly sessionStore: ChatSessionStore;
  readonly sessions: ChatSessionService;
  readonly coordinator: ChatRunCoordinator;
  registerRoutes(server: FastifyInstance): void;
  recover(): Promise<void>;
  close(): Promise<void>;
}

function resolveSessionStore(
  options: ConversationModuleOptions,
): ChatSessionStore {
  if (options.sessionStore !== undefined) return options.sessionStore;
  if (options.database === undefined) {
    throw new Error(
      "注入数据库替身时必须同时注入 sessionStore：生产路径不会回退到内存仓储",
    );
  }
  return new MySqlChatSessionStore({ db: options.database });
}

/**
 * 创建 Conversation 模块。
 *
 * 模块内部完成仓储、应用服务、run 协调器和 HTTP 路由的装配；API bootstrap 只依赖
 * 此入口，不再直接依赖模块内部的每一个实现文件。
 */
export function createConversationModule(
  options: ConversationModuleOptions,
): ConversationModule {
  const sessionStore = resolveSessionStore(options);
  const sessions = new ChatSessionService({ store: sessionStore });
  const coordinator = new ChatRunCoordinator({
    sessions,
    agentClient: options.agentClient,
    logger: options.logger,
  });

  let recovered = false;
  const recover = async (): Promise<void> => {
    if (recovered) return;
    try {
      const summary = await sessionStore.recoverInterruptedRuns({
        updatedAt: new Date().toISOString(),
      });
      recovered = true;
      options.logger.info("chat.recovery.completed", {
        runs: summary.runs,
        messages: summary.messages,
      });
    } catch {
      options.logger.warn("chat.recovery.failed");
    }
  };

  let closed = false;
  return {
    sessionStore,
    sessions,
    coordinator,
    registerRoutes(server): void {
      registerConversationRoutes(server, {
        sessions,
        runCoordinator: coordinator,
        logger: options.logger,
      });
    },
    recover,
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await coordinator.close();
    },
  };
}
