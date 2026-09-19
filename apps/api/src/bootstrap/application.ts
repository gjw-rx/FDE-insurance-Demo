import Fastify, { type FastifyInstance } from "fastify";
import { loadApiConfig, type ApiConfig } from "../config/api-config.js";
import { AgentServiceClient } from "../infrastructure/agent/agent-service-client.js";
import {
  registerChatRoutes,
  type ChatAgentClient,
} from "../interfaces/http/chat-routes.js";

/**
 * 业务 API 组合根：装配配置、Agent typed client 与公开对话路由。
 *
 * 当前 change 只包含最小对话链路：不引入数据库、身份或业务用例层；
 * 测试可注入替身 client，生产实现通过环境配置连接 insurance-agent。
 * 浏览器始终同源访问（Vite 代理/生产网关），因此不注册 CORS。
 */

export interface ApiAppOptions {
  readonly config?: ApiConfig;
  /** 测试注入的 Agent client 替身；缺省时按配置构造真实 typed client。 */
  readonly agentClient?: ChatAgentClient;
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

  const agentClient =
    options.agentClient ??
    new AgentServiceClient({
      baseUrl: config.agentBaseUrl,
      connectTimeoutMs: config.agentConnectTimeoutMs,
      responseTimeoutMs: config.agentResponseTimeoutMs,
    });

  server.get("/health/live", async () => ({ status: "ok" as const }));

  registerChatRoutes(server, { agentClient });

  let closed = false;
  return {
    config,
    server,
    listen: () => server.listen({ host: config.host, port: config.port }),
    close: async () => {
      if (closed) return;
      closed = true;
      await server.close();
    },
  };
}
