import { describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import type { DatabaseConfig } from "../../src/config/database-config.js";
import { createMySqlPool } from "../../src/infrastructure/database/mysql-database.js";
import { resolveIntegrationTarget } from "../support/database-test-target.js";
import { migrateTestEnv } from "../support/migrate-test-env.js";
import { runMigrate } from "../support/migrate-command-runner.js";
import { readCell } from "../support/mysql-row.js";

/**
 * 数据库迁移集成测试（需要真实数据库）。
 *
 * 通过真实迁移进程验证：首次应用、重复执行幂等、并发互斥，以及迁移后的表集合。
 * 未配置 `DATABASE_TEST_URL` 时整个文件跳过并给出原因，不计为通过。
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

/** 本 change 批准创建的会话业务表。 */
const APPROVED_TABLES: readonly string[] = [
  "chat_message",
  "chat_run",
  "chat_session",
];

/** 仍不属于本次范围的业务表：出现即说明迁移范围越界。 */
const FORBIDDEN_TABLES: readonly string[] = [
  "renewal_cases",
  "quotes",
  "materials",
  "users",
];

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
  it("首次迁移建立迁移元数据并创建已批准的三张业务表", async () => {
    const result = await runMigrate(migrateTestEnv());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("db.migrate.completed");
    // 启动与迁移输出都不含完整连接串。
    expect(result.stdout).not.toContain("mysql://");

    const tables = await listTables(requireTarget().config);
    expect(tables).toContain(MIGRATIONS_TABLE);
    for (const approved of APPROVED_TABLES) {
      expect(tables).toContain(approved);
    }
    for (const forbidden of FORBIDDEN_TABLES) {
      expect(tables).not.toContain(forbidden);
    }
  });

  it("重复执行迁移是幂等的，不会重复应用同一版本", async () => {
    const first = await runMigrate(migrateTestEnv());
    expect(first.code).toBe(0);
    const afterFirst = await migrationRowCount(requireTarget().config);

    const second = await runMigrate(migrateTestEnv());
    expect(second.code).toBe(0);
    const afterSecond = await migrationRowCount(requireTarget().config);

    expect(afterSecond).toBe(afterFirst);
    // 空基线 + 会话业务表迁移，至少两条版本记录。
    expect(afterSecond).toBeGreaterThanOrEqual(2);
  });

  it("并发执行迁移由数据库互斥串行化，两个执行者都成功结束", async () => {
    const [first, second] = await Promise.all([
      runMigrate(migrateTestEnv()),
      runMigrate(migrateTestEnv()),
    ]);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(first.stderr).not.toContain("migration-lock-timeout");
    expect(second.stderr).not.toContain("migration-lock-timeout");
  });
});
