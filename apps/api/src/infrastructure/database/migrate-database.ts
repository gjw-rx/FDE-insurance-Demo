import {
  createConnection,
  type Connection,
  type ConnectionOptions,
  type RowDataPacket,
} from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { ApiConfigError } from "../../config/config-error.js";
import type { DatabaseConfig } from "../../config/database-config.js";
import {
  buildConnectionBase,
  readErrorCode,
  resolveSslOptions,
} from "./mysql-database.js";

/**
 * 数据库迁移执行器。
 *
 * 迁移只在发布流程中显式执行，API 进程不在启动时迁移：多副本同时启动时隐式改库
 * 会让发布结果不可预测，也无法给出稳定的失败退出码。
 *
 * MySQL 的 DDL 会隐式提交，因此这里不承诺「多语句原子回滚」，而是用两个更可靠
 * 的保证替代：
 * - 数据库级互斥锁：同一时刻只有一个执行者改结构，其余执行者要么等到锁释放后
 *   确认版本已最新，要么在规定超时内失败退出。
 * - 失败即非零退出：迁移未成功完成时，迁移记录表不会写入该版本。
 */

/** 迁移互斥锁名；同一数据库上的所有执行者必须使用同一个名字。 */
export const MIGRATION_LOCK_NAME = "renewal_api_migration";

/** 等待互斥锁超时：说明已有其他执行者正在迁移，本次直接失败而不是继续改库。 */
export class MigrationLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationLockError";
  }
}

export interface MigrateDatabaseOptions {
  readonly config: DatabaseConfig;
  /** 迁移文件目录，需包含 `meta/_journal.json` 与各迁移 `.sql` 文件。 */
  readonly migrationsFolder: string;
  /** 等待互斥锁的秒数；超时即失败，不无限等待。 */
  readonly lockTimeoutSeconds?: number;
}

const DEFAULT_LOCK_TIMEOUT_SECONDS = 10;

/** 获取数据库级互斥锁；返回是否成功，不向上抛出驱动错误。 */
async function acquireMigrationLock(
  connection: Connection,
  timeoutSeconds: number,
): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "select get_lock(?, ?) as acquired",
    [MIGRATION_LOCK_NAME, timeoutSeconds],
  );
  const first: RowDataPacket | undefined = rows[0];
  if (first === undefined) return false;
  // 驱动返回类型是索引签名，先收窄为 unknown 再判断，避免 any 泄漏到业务代码。
  const acquired: unknown = first["acquired"];
  return acquired === 1 || acquired === "1";
}

/** 释放互斥锁；连接关闭也会释放，这里显式释放以便尽早让出给下一个执行者。 */
async function releaseMigrationLock(connection: Connection): Promise<void> {
  await connection.query("select release_lock(?)", [MIGRATION_LOCK_NAME]);
}

/**
 * 应用全部未执行的迁移。
 *
 * 幂等：是否已应用由 drizzle 迁移记录表（`__drizzle_migrations`）记录，重复执行
 * 不会再次应用同一版本。首次执行只建立迁移元数据，不创建任何业务表。
 */
export async function migrateDatabase(
  options: MigrateDatabaseOptions,
): Promise<void> {
  const { config, migrationsFolder } = options;
  const lockTimeoutSeconds =
    options.lockTimeoutSeconds ?? DEFAULT_LOCK_TIMEOUT_SECONDS;

  const ssl = resolveSslOptions(config.tls);
  const connectionOptions: ConnectionOptions = buildConnectionBase(config);
  if (ssl !== undefined) {
    connectionOptions.ssl = ssl;
  }

  const connection = await createConnection(connectionOptions);
  try {
    if (!(await acquireMigrationLock(connection, lockTimeoutSeconds))) {
      throw new MigrationLockError(
        `等待迁移互斥锁超时（${lockTimeoutSeconds}s），可能已有其他执行者正在迁移`,
      );
    }
    try {
      const db = drizzle(connection);
      await migrate(db, { migrationsFolder });
    } finally {
      await releaseMigrationLock(connection);
    }
  } finally {
    await connection.end();
  }
}

/** 把迁移失败归类为不含凭据的稳定标识，供 CLI 输出与排障定位。 */
export function describeMigrateFailure(error: unknown): string {
  if (error instanceof MigrationLockError) return "migration-lock-timeout";
  if (error instanceof ApiConfigError) return `config-invalid:${error.field}`;
  const code = readErrorCode(error);
  return code === "unknown" ? "migration-failed" : `migration-failed:${code}`;
}
