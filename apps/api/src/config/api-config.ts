import { ApiConfigError } from "./config-error.js";
import { readPositiveInteger } from "./env-reading.js";

export { ApiConfigError, type ApiConfigErrorCode } from "./config-error.js";

/**
 * 业务 API 的非敏感运行配置。
 *
 * 只从环境变量读取 host、port、Agent 服务地址与超时；不包含任何密钥。
 * 非法输入一律在启动阶段抛出 ApiConfigError（错误只带字段名与规则，不带值）。
 * 数据库连接配置见 database-config.ts，两者共同构成完整启动配置。
 */

export interface ApiConfig {
  /** 对外监听地址；默认仅 loopback，生产暴露由部署网关决定。 */
  readonly host: string;
  readonly port: number;
  /** insurance-agent 内部服务基地址。 */
  readonly agentBaseUrl: string;
  readonly agentConnectTimeoutMs: number;
  readonly agentResponseTimeoutMs: number;
}

export interface LoadApiConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4300;
const DEFAULT_AGENT_BASE_URL = "http://127.0.0.1:4310";
const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 300_000;

/** 解析非负整数字段（0 仅允许 port，表示随机端口）；缺失用默认值，非法即拒绝。 */
function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new ApiConfigError(
      "config-invalid",
      "API_PORT",
      "API_PORT 必须是 0-65535 之间的整数（0 表示随机端口）",
    );
  }
  return value;
}

/** 读取并严格校验 API 运行配置。 */
export function loadApiConfig(options: LoadApiConfigOptions = {}): ApiConfig {
  const env = options.env ?? process.env;

  const host = env.API_HOST?.trim() || DEFAULT_HOST;

  const port = readPort(env.API_PORT);

  const agentBaseUrlRaw = env.AGENT_BASE_URL?.trim() || DEFAULT_AGENT_BASE_URL;
  let agentBaseUrl: URL;
  try {
    agentBaseUrl = new URL(agentBaseUrlRaw);
  } catch {
    throw new ApiConfigError(
      "config-invalid",
      "AGENT_BASE_URL",
      "AGENT_BASE_URL 必须是合法的 http(s) URL",
    );
  }
  if (agentBaseUrl.protocol !== "http:" && agentBaseUrl.protocol !== "https:") {
    throw new ApiConfigError(
      "config-invalid",
      "AGENT_BASE_URL",
      "AGENT_BASE_URL 必须使用 http 或 https 协议",
    );
  }
  if (agentBaseUrl.pathname !== "/" || agentBaseUrl.search !== "") {
    throw new ApiConfigError(
      "config-invalid",
      "AGENT_BASE_URL",
      "AGENT_BASE_URL 只能是服务基地址，不能带路径或查询",
    );
  }

  return {
    host,
    port,
    agentBaseUrl: agentBaseUrlRaw,
    agentConnectTimeoutMs: readPositiveInteger(
      "AGENT_CONNECT_TIMEOUT_MS",
      env.AGENT_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECT_TIMEOUT_MS,
      600_000,
    ),
    agentResponseTimeoutMs: readPositiveInteger(
      "AGENT_RESPONSE_TIMEOUT_MS",
      env.AGENT_RESPONSE_TIMEOUT_MS,
      DEFAULT_RESPONSE_TIMEOUT_MS,
      600_000,
    ),
  };
}
