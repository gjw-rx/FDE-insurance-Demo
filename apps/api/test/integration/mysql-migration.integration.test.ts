import { describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import type { DatabaseConfig } from "../../src/config/database-config.js";
import { createMySqlPool } from "../../src/infrastructure/database/mysql-database.js";
import { resolveIntegrationTarget } from "../support/database-test-target.js";
import { runMigrate } from "../support/migrate-command-runner.js";
import { readCell } from "../support/mysql-row.js";

/**
 * 数据库迁移集成测试（需要真实数据库）。
 *
 * 通过真实迁移进程验证：首次应用、重复执行幂等、并发互斥，以及基线迁移不创建
 * 任何业务表。未配置 `DATABASE_TEST_URL` 时整个文件跳过并给出原因，不计为通过。
 */

const resolution = resolveIntegrationTarget();
if (!resolution.ok) {
  process.stderr.write(`[integration] 未执行原因：${resolution.reason}\n`);
}

function requireTarget() {
  if (!resolution.ok) {
    throw new Error(`集成测试目标不可用：${resolution.reason}`);
  }
  return resolution.target;
}

/** 迁移记录表由 drizzle 迁移器创建。 */
const MIGRATIONS_TABLE = "__drizzle_migrations";

/** 基线迁移后不应存在的业务表：本 change 不创建任何业务结构。 */
const FORBIDDEN_TABLES: readonly string[] = [
  "chat_sessions",
  "chat_messages",
  "chat_runs",
  "renewal_cases",
  "quotes",
  "materials",
  "users",
];

/** 让迁移命令连接到与集成测试相同的目标。 */
function migrateEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: process.env["DATABASE_TEST_URL"] ?? "",
  };
}

/** 列出目标库中的全部表名（小写）。 */
async function listTables(config: DatabaseConfig): Promise<string[]> {
  const pool = createMySqlPool(config);
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      "select table_name as tableName from information_schema.tables where table_schema = database()",
    );
    return rows.map((row) => String(readCell(row, "tableName")).toLowerCase());
  } finally {
    await pool.end();
  }
}

/** 迁移记录条数，用于验证重复执行不会重复应用。 */
async function migrationRowCount(config: DatabaseConfig): Promise<number> {
  const pool = createMySqlPool(config);
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `select count(*) as total from ${MIGRATIONS_TABLE}`,
    );
    return Number(readCell(rows[0], "total"));
  } finally {
    await pool.end();
  }
}

describe.skipIf(!resolution.ok)("数据库迁移（真实数据库）", () => {
  it("首次迁移建立迁移元数据，且不创建任何业务表", async () => {
    const result = await runMigrate(migrateEnv());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("db.migrate.completed");
    // 启动与迁移输出都不含完整连接串。
    expect(result.stdout).not.toContain("mysql://");

    const tables = await listTables(requireTarget().config);
    expect(tables).toContain(MIGRATIONS_TABLE);
    for (const forbidden of FORBIDDEN_TABLES) {
      expect(tables).not.toContain(forbidden);
    }
  });

  it("重复执行迁移是幂等的，不会重复应用同一版本", async () => {
    const first = await runMigrate(migrateEnv());
    expect(first.code).toBe(0);
    const afterFirst = await migrationRowCount(requireTarget().config);

    const second = await runMigrate(migrateEnv());
    expect(second.code).toBe(0);
    const afterSecond = await migrationRowCount(requireTarget().config);

    expect(afterSecond).toBe(afterFirst);
  });

  it("并发执行迁移由数据库互斥串行化，两个执行者都成功结束", async () => {
    const [first, second] = await Promise.all([
      runMigrate(migrateEnv()),
      runMigrate(migrateEnv()),
    ]);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(first.stderr).not.toContain("migration-lock-timeout");
    expect(second.stderr).not.toContain("migration-lock-timeout");
  });
});
