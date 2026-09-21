import { describe, expect, it } from "vitest";
import { loadDatabaseConfig } from "../../../src/platform/config/database_config.js";
import { createMySqlDatabase } from "../../../src/platform/database/mysql_database.js";

/**
 * MySQL 数据库基础设施测试。
 *
 * 这些用例不需要真实数据库：mysql2 创建连接池时不会建立 TCP 连接，因此可以
 * 验证「启动成功不等于数据库可用」以及在数据库不可达时的收敛行为。
 * 真实连接、迁移与 TLS 由集成测试（test/integration）覆盖。
 */

/** 指向必然无人监听的本地端口，用于确定性地制造连接失败。 */
const UNREACHABLE_PORT = 1;

describe("MySQL 数据库基础设施", () => {
  it("数据库不可达时就绪检查返回未就绪而不是抛出", async () => {
    const config = loadDatabaseConfig({
      env: {
        NODE_ENV: "test",
        DATABASE_URL: `mysql://user:password@127.0.0.1:${UNREACHABLE_PORT}/renewal`,
        DATABASE_TLS_MODE: "disabled",
        DATABASE_ALLOW_INSECURE_TLS: "true",
        DATABASE_CONNECT_TIMEOUT_MS: "2000",
        DATABASE_QUERY_TIMEOUT_MS: "2000",
      },
    });
    const database = createMySqlDatabase(config);

    try {
      const readiness = await database.checkReadiness();
      expect(readiness.ready).toBe(false);
      if (!readiness.ready) {
        expect(["connect-failed", "timeout"]).toContain(readiness.reason);
      }
    } finally {
      await database.close();
    }
  });

  it("连接目标摘要不含凭据，且 close 可重复调用", async () => {
    const config = loadDatabaseConfig({
      env: {
        DATABASE_URL:
          "mysql://renewal-user:super-secret-password@db.internal:3307/renewal",
      },
    });
    const database = createMySqlDatabase(config);

    expect(database.target).toBe("db.internal:3307/renewal");
    expect(database.target).not.toContain("renewal-user");
    expect(database.target).not.toContain("super-secret-password");

    await database.close();
    await database.close();
  });

  it("关闭连接池后就绪检查收敛为未就绪而不是抛出", async () => {
    const config = loadDatabaseConfig({
      env: {
        DATABASE_URL: `mysql://user:password@127.0.0.1:${UNREACHABLE_PORT}/renewal`,
        DATABASE_TLS_MODE: "disabled",
        DATABASE_ALLOW_INSECURE_TLS: "true",
      },
    });
    const database = createMySqlDatabase(config);
    await database.close();

    const readiness = await database.checkReadiness();
    expect(readiness.ready).toBe(false);
  });
});
