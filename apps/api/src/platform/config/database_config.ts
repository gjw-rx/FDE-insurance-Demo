import { ApiConfigError } from "./config_error.js";
import { readBooleanFlag, readPositiveInteger } from "./env_reading.js";

/**
 * 业务 API 的 MySQL 连接配置。
 *
 * 连接地址只从运行环境（云端部署时为 secret provider）注入，本模块负责在启动
 * 阶段把它解析成强类型结构并拒绝不安全组合。错误消息只包含环境变量名和规则，
 * 不包含连接地址、用户名、密码或证书正文。
 *
 * 安全默认：TLS 默认为 `verify-identity`（校验证书链与主机名）。禁用 TLS 需要
 * 显式设置 `DATABASE_ALLOW_INSECURE_TLS=true`，且在生产环境一律被拒绝。
 */

export type DatabaseTlsMode = "verify-identity" | "disabled";

/** TLS 配置：除显式的非生产豁免外，一律要求校验证书与主机名。 */
export type DatabaseTlsConfig =
  | { readonly mode: "disabled" }
  | {
      readonly mode: "verify-identity";
      /** 自定义 CA 证书文件路径；未提供时使用系统信任链。 */
      readonly caFilePath: string | undefined;
    };

/** 连接目标：不含凭据，可安全写入日志与启动摘要。 */
export interface DatabaseTarget {
  readonly host: string;
  readonly port: number;
  readonly database: string;
}

/** 连接凭据：只能注入连接池，禁止写入日志、错误响应或测试产物。 */
export interface DatabaseCredentials {
  readonly user: string;
  readonly password: string;
}

/** 连接池与超时边界；全部为有限值，避免无界排队与无限等待。 */
export interface DatabasePoolSettings {
  readonly connectionLimit: number;
  readonly queueLimit: number;
  readonly connectTimeoutMs: number;
  readonly queryTimeoutMs: number;
}

export interface DatabaseConfig {
  readonly target: DatabaseTarget;
  readonly credentials: DatabaseCredentials;
  readonly tls: DatabaseTlsConfig;
  readonly pool: DatabasePoolSettings;
}

export interface LoadDatabaseConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
}

const DATABASE_URL_FIELD = "DATABASE_URL";
const DEFAULT_PORT = 3306;
const DEFAULT_TLS_MODE: DatabaseTlsMode = "verify-identity";
const DEFAULT_POOL_SIZE = 10;
const DEFAULT_QUEUE_LIMIT = 20;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const MAX_POOL_SIZE = 50;
const MAX_QUEUE_LIMIT = 500;
const MAX_CONNECT_TIMEOUT_MS = 60_000;
const MAX_QUERY_TIMEOUT_MS = 120_000;

interface ParsedDatabaseUrl {
  readonly target: DatabaseTarget;
  readonly credentials: DatabaseCredentials;
}

/** 解码 URL 中的百分号转义；转义非法时按配置错误拒绝，不回显原值。 */
function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 含无效的百分号转义`,
    );
  }
}

/** 解析连接地址；只做结构与必填校验，不做任何网络访问。 */
function parseDatabaseUrl(raw: string | undefined): ParsedDatabaseUrl {
  const value = raw?.trim() ?? "";
  if (value === "") {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 必填：需要提供 mysql:// 连接地址`,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 必须是合法的 mysql:// 连接地址`,
    );
  }

  if (url.protocol !== "mysql:") {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 必须使用 mysql: 协议（TLS 由 DATABASE_TLS_MODE 控制）`,
    );
  }
  if (url.search !== "") {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 不能携带查询参数，请使用 DATABASE_TLS_MODE 等独立变量`,
    );
  }
  if (url.hostname === "") {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 必须包含数据库主机名`,
    );
  }

  const port = url.port === "" ? DEFAULT_PORT : Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 的端口必须在 1-65535 之间`,
    );
  }

  const database = decodeUrlComponent(url.pathname).replace(/^\//, "");
  if (database === "" || database.includes("/")) {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 必须包含数据库名，且不能出现在路径子层级`,
    );
  }

  const user = decodeUrlComponent(url.username);
  if (user === "") {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 必须包含数据库用户名`,
    );
  }

  const password = decodeUrlComponent(url.password);
  if (password === "") {
    throw new ApiConfigError(
      "config-invalid",
      DATABASE_URL_FIELD,
      `${DATABASE_URL_FIELD} 必须包含数据库密码`,
    );
  }

  return {
    target: { host: url.hostname, port, database },
    credentials: { user, password },
  };
}

/** 解析 TLS 配置；禁用 TLS 需要显式确认且不允许出现在生产环境。 */
function parseTlsConfig(env: NodeJS.ProcessEnv): DatabaseTlsConfig {
  const rawMode = env.DATABASE_TLS_MODE?.trim() || DEFAULT_TLS_MODE;
  if (rawMode !== "verify-identity" && rawMode !== "disabled") {
    throw new ApiConfigError(
      "config-invalid",
      "DATABASE_TLS_MODE",
      "DATABASE_TLS_MODE 只接受 verify-identity 或 disabled",
    );
  }

  const caFilePath = env.DATABASE_CA_FILE?.trim() || undefined;

  if (rawMode === "verify-identity") {
    return { mode: "verify-identity", caFilePath };
  }

  if (
    !readBooleanFlag(
      "DATABASE_ALLOW_INSECURE_TLS",
      env.DATABASE_ALLOW_INSECURE_TLS,
    )
  ) {
    throw new ApiConfigError(
      "config-invalid",
      "DATABASE_TLS_MODE",
      "禁用数据库 TLS 必须同时设置 DATABASE_ALLOW_INSECURE_TLS=true 显式确认",
    );
  }
  if (env.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new ApiConfigError(
      "config-invalid",
      "DATABASE_TLS_MODE",
      "生产环境禁止禁用数据库 TLS",
    );
  }
  if (caFilePath !== undefined) {
    throw new ApiConfigError(
      "config-invalid",
      "DATABASE_CA_FILE",
      "禁用数据库 TLS 时不能同时配置 DATABASE_CA_FILE",
    );
  }

  return { mode: "disabled" };
}

/** 解析连接池与超时边界。 */
function parsePoolSettings(env: NodeJS.ProcessEnv): DatabasePoolSettings {
  return {
    connectionLimit: readPositiveInteger(
      "DATABASE_POOL_SIZE",
      env.DATABASE_POOL_SIZE,
      DEFAULT_POOL_SIZE,
      MAX_POOL_SIZE,
    ),
    queueLimit: readPositiveInteger(
      "DATABASE_QUEUE_LIMIT",
      env.DATABASE_QUEUE_LIMIT,
      DEFAULT_QUEUE_LIMIT,
      MAX_QUEUE_LIMIT,
    ),
    connectTimeoutMs: readPositiveInteger(
      "DATABASE_CONNECT_TIMEOUT_MS",
      env.DATABASE_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECT_TIMEOUT_MS,
      MAX_CONNECT_TIMEOUT_MS,
    ),
    queryTimeoutMs: readPositiveInteger(
      "DATABASE_QUERY_TIMEOUT_MS",
      env.DATABASE_QUERY_TIMEOUT_MS,
      DEFAULT_QUERY_TIMEOUT_MS,
      MAX_QUERY_TIMEOUT_MS,
    ),
  };
}

/** 读取并严格校验 MySQL 连接配置；缺失 `DATABASE_URL` 即拒绝启动。 */
export function loadDatabaseConfig(
  options: LoadDatabaseConfigOptions = {},
): DatabaseConfig {
  const env = options.env ?? process.env;
  const parsed = parseDatabaseUrl(env.DATABASE_URL);

  return {
    target: parsed.target,
    credentials: parsed.credentials,
    tls: parseTlsConfig(env),
    pool: parsePoolSettings(env),
  };
}

/** 生成不含凭据的连接目标摘要，用于启动摘要、日志与诊断。 */
export function describeDatabaseTarget(target: DatabaseTarget): string {
  return `${target.host}:${target.port}/${target.database}`;
}
