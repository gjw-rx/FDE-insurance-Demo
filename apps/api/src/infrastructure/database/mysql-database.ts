import { readFileSync } from "node:fs";
import {
  createPool,
  type ConnectionOptions,
  type Pool,
  type PoolOptions,
  type SslOptions,
} from "mysql2/promise";
import { ApiConfigError } from "../../config/config-error.js";
import {
  describeDatabaseTarget,
  type DatabaseConfig,
  type DatabaseTlsConfig,
} from "../../config/database-config.js";

/**
 * MySQL 连接池基础设施。
 *
 * 本 change 只建立连接边界，不提供任何业务查询抽象：连接池当前的唯一消费者是
 * 就绪探针，业务表与 DAO 属于后续独立 change。业务层（application/domain/contracts）
 * 不依赖本模块或 mysql2。
 *
 * 关键约束：
 * - 池创建不建立 TCP 连接，因此进程启动成功不代表数据库可用；可用性只由
 *   `checkReadiness` 表达，两者必须分离。
 * - 所有超时都是有限值，失败只返回稳定原因，不向上抛出驱动错误细节。
 * - `close` 幂等，供优雅关闭重复调用。
 */

/** 就绪失败原因：只用于内部诊断与日志，不包含驱动错误细节。 */
export type DatabaseReadinessFailureReason = "connect-failed" | "timeout";

export type DatabaseReadiness =
  | { readonly ready: true }
  | { readonly ready: false; readonly reason: DatabaseReadinessFailureReason };

/** 数据库基础设施对组合根暴露的最小接口。 */
export interface MySqlDatabase {
  /** 不含凭据的连接目标摘要，可安全写入日志。 */
  readonly target: string;
  checkReadiness(): Promise<DatabaseReadiness>;
  close(): Promise<void>;
}

/** 就绪探针查询：单行、无副作用、不触碰业务数据。 */
const READINESS_SQL = "select 1";

/** 从无类型错误对象中提取驱动错误码；提取不到时返回 `unknown`。 */
export function readErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

/** 区分超时与连接/认证失败；用于日志诊断，不参与对外响应文案。 */
function classifyReadinessFailure(
  error: unknown,
): DatabaseReadinessFailureReason {
  const code = readErrorCode(error);
  if (code === "PROTOCOL_SEQUENCE_TIMEOUT" || code === "ETIMEDOUT") {
    return "timeout";
  }
  return "connect-failed";
}

/**
 * 读取自定义 CA 证书（同步）。
 *
 * 证书在启动装配阶段一次性读入，因此可以同步完成：这保证「证书文件缺失或不可读」
 * 在监听端口前就以配置错误被拒绝，而不是推迟到第一次握手。失败只报告字段名与
 * 系统错误码，不回显路径或证书正文。
 */
function readCaFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new ApiConfigError(
      "config-invalid",
      "DATABASE_CA_FILE",
      `DATABASE_CA_FILE 指向的证书文件无法读取（${readErrorCode(error)}）`,
    );
  }
}

/**
 * 解析 TLS 选项。
 *
 * mysql2 默认不校验服务器主机名（`verifyIdentity` 默认 false），因此
 * `verify-identity` 必须同时打开 `rejectUnauthorized` 与 `verifyIdentity`。
 */
export function resolveSslOptions(
  tls: DatabaseTlsConfig,
): SslOptions | undefined {
  if (tls.mode === "disabled") return undefined;

  const options: SslOptions = {
    rejectUnauthorized: true,
    verifyIdentity: true,
    minVersion: "TLSv1.2",
  };
  if (tls.caFilePath !== undefined) {
    options.ca = readCaFile(tls.caFilePath);
  }
  return options;
}

/**
 * 连接基础字段：连接池与迁移用的单连接共用，凭据只在此处进入驱动。
 *
 * 迁移必须使用单连接，因为数据库级互斥锁是连接级的：连接池会在不同连接之间
 * 切换，无法在迁移期间保持同一把锁。
 */
export function buildConnectionBase(config: DatabaseConfig): ConnectionOptions {
  return {
    host: config.target.host,
    port: config.target.port,
    user: config.credentials.user,
    password: config.credentials.password,
    database: config.target.database,
    connectTimeout: config.pool.connectTimeoutMs,
  };
}

/** 把配置映射为 mysql2 连接池选项。 */
function buildPoolOptions(
  config: DatabaseConfig,
  ssl: SslOptions | undefined,
): PoolOptions {
  const options: PoolOptions = {
    ...buildConnectionBase(config),
    connectionLimit: config.pool.connectionLimit,
    queueLimit: config.pool.queueLimit,
    waitForConnections: true,
    // 归还连接前重置连接级状态（用户变量、临时表、未结束事务）。mysql2 默认
    // 为 false，即复用连接时会带上一个请求留下的会话状态；显式开启避免污染，
    // 并让忘记提交或回滚的事务在归还时被服务端回滚而不是留给下一个请求。
    resetOnRelease: true,
  };
  if (ssl !== undefined) {
    options.ssl = ssl;
  }
  return options;
}

/**
 * 创建 MySQL 连接池。
 *
 * 供组合根与集成测试使用。创建时不会建立 TCP 连接，因此启动阶段不会因数据库
 * 不可达而阻塞；调用方负责在退出前关闭。
 */
export function createMySqlPool(config: DatabaseConfig): Pool {
  return createPool(buildPoolOptions(config, resolveSslOptions(config.tls)));
}

/**
 * 执行一次有界就绪检查：借一条连接执行 `select 1`。
 *
 * 无论成功或失败，连接都由连接池按 `resetOnRelease` 规则归还；mysql2 的查询
 * 超时会销毁该连接，因此超时不会把损坏的连接留在池中。
 */
export async function checkDatabaseReadiness(
  pool: Pool,
  queryTimeoutMs: number,
): Promise<DatabaseReadiness> {
  try {
    await pool.query({ sql: READINESS_SQL, timeout: queryTimeoutMs });
    return { ready: true };
  } catch (error) {
    return { ready: false, reason: classifyReadinessFailure(error) };
  }
}

/** 创建数据库基础设施句柄；`close` 幂等，重复关闭不产生额外副作用。 */
export function createMySqlDatabase(config: DatabaseConfig): MySqlDatabase {
  const pool = createMySqlPool(config);
  let closed = false;

  return {
    target: describeDatabaseTarget(config.target),
    checkReadiness: () =>
      checkDatabaseReadiness(pool, config.pool.queryTimeoutMs),
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
