import { describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import {
  createMySqlDatabase,
  createMySqlPool,
} from "../../src/infrastructure/database/mysql-database.js";
import { resolveIntegrationTarget } from "../support/database-test-target.js";
import { readCell } from "../support/mysql-row.js";

/**
 * MySQL 连接与查询边界集成测试（需要真实数据库）。
 *
 * 目标由 `DATABASE_TEST_URL` 提供，且必须通过 `test/support/database-test-target.ts`
 * 的安全护栏；未配置或无法证明为非生产库时整个文件跳过，并在输出中给出原因，
 * 不计为通过。
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

describe.skipIf(!resolution.ok)("MySQL 连接与查询边界（真实数据库）", () => {
  it("连接池可完成真实往返，并在关闭后拒绝新查询", async () => {
    const pool = createMySqlPool(requireTarget().config);

    try {
      const [rows] = await pool.query<RowDataPacket[]>("select 1 as value");
      expect(readCell(rows[0], "value")).toBe(1);
    } finally {
      await pool.end();
    }

    await expect(pool.query("select 1")).rejects.toThrow();
  });

  it("参数化查询把 SQL 元字符当作数据，而不是可执行 SQL", async () => {
    const pool = createMySqlPool(requireTarget().config);

    try {
      const payload = "'; drop table chat_sessions; --";
      const [rows] = await pool.query<RowDataPacket[]>("select ? as echo", [
        payload,
      ]);
      expect(readCell(rows[0], "echo")).toBe(payload);
    } finally {
      await pool.end();
    }
  });

  it("就绪检查对真实数据库返回就绪，连接池关闭后收敛为未就绪", async () => {
    const database = createMySqlDatabase(requireTarget().config);

    try {
      await expect(database.checkReadiness()).resolves.toEqual({ ready: true });
    } finally {
      await database.close();
    }

    const after = await database.checkReadiness();
    expect(after.ready).toBe(false);
  });

  it("错误凭据只产生未就绪，不向上抛出驱动细节", async () => {
    const target = requireTarget();
    const database = createMySqlDatabase({
      ...target.config,
      credentials: {
        user: "renewal_definitely_wrong_user",
        password: "renewal_definitely_wrong_password",
      },
    });

    try {
      const readiness = await database.checkReadiness();
      expect(readiness.ready).toBe(false);
    } finally {
      await database.close();
    }
  });
});
