import { readFileSync } from "node:fs";
import {
 createPool,
 type ConnectionOptions,
 type Pool,
 type PoolOptions,
 type SslOptions,
} from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { ApiConfigError } from "../config/config_error.js";
import {
 describeDatabaseTarget,
 type DatabaseConfig,
 type DatabaseTlsConfig,
} from "../config/database_config.js";

/**
 * MySQL 连接池基础设施。
 *
 * 职责是建立唯一的连接边界：连接池、就绪探针、Drizzle 查询句柄与幂等关闭。业务
 * 查询与事务由 `infrastructure/persistence` 下的仓储实现使用该句柄完成；
 * `packages/domain`、`packages/application` 与 `packages/contracts` 不依赖本模块
 * 或 mysql2。
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

/**
 * Drizzle 查询与事务句柄。
 *
 * 类型不绑定具体 schema：业务表定义在 `apps/api/drizzle/` 中按领域维护，仓储直接
 * 导入表对象，因此句柄只提供参数化查询与事务能力。
 */
export type MySqlQueryHandle = MySql2Database<Record<string, never>>;

/** 数据库基础设施对组合根暴露的最小接口。 */
export interface MySqlDatabase {
 /** 不含凭据的连接目标摘要，可安全写入日志。 */
 readonly target: string;
 /**
  * Drizzle 查询句柄。
  *
  * 测试替身可以不提供；缺失时组合根要求显式注入会话仓储，不会静默回退到内存实现。
  */
 readonly db?: MySqlQueryHandle;
 checkReadiness(): Promise<DatabaseReadiness>;
 close(): Promise<void>;
}

/** 就绪探针查询：单行、无副作用、不触碰业务数据。 */
const READINESS_SQL = "select 1";

/**
 * 从错误对象中提取驱动错误码；提取不到时返回 `unknown`。
 *
 * drizzle 会把驱动错误包一层（原错误放在 `cause` 上），因此需要沿 `cause` 链查找，
 * 否则唯一键冲突、超时等稳定错误码会被当成「未知错误」，导致错误归类与幂等判定失效。
 * 深度有上限，避免异常构造出的循环引用。
 */
export function readErrorCode(error: unknown): string {
 return readErrorCodeAtDepth(error, 0);
}

function readErrorCodeAtDepth(error: unknown, depth: number): string {
 if (depth > MAX_ERROR_CAUSE_DEPTH) return "unknown";
 if (typeof error !== "object" || error === null) return "unknown";

 if ("code" in error) {
  const code = (error as { readonly code?: unknown }).code;
  if (typeof code === "string") return code;
 }
 if ("cause" in error) {
  return readErrorCodeAtDepth(
   (error as { readonly cause?: unknown }).cause,
   depth + 1,
  );
 }
 return "unknown";
}

/** `cause` 链的最大查找深度。 */
const MAX_ERROR_CAUSE_DEPTH = 5;

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
  // DATETIME(3) 列按 UTC 挂钟值写入。mysql2 默认把 DATETIME 解析成本地时区的
  // Date 对象，会让读出的时刻随部署机器时区漂移；这里关闭驱动侧日期解析，由
  // 仓储负责在 ISO 8601 与 MySQL 字面量之间显式转换。
  dateStrings: true,
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
  db: drizzle(pool),
  checkReadiness: () =>
   checkDatabaseReadiness(pool, config.pool.queryTimeoutMs),
  close: async (): Promise<void> => {
   if (closed) return;
   closed = true;
   await pool.end();
  },
 };
}
