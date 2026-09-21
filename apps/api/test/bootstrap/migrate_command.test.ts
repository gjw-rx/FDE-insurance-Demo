import { describe, expect, it } from "vitest";
import { runMigrate } from "../support/migrate_command_runner.js";

/**
 * 迁移命令的失败语义测试。
 *
 * 这些用例不需要真实数据库：验证的是「配置缺失」与「数据库不可达」两种情况都
 * 以非零状态退出、给出稳定标识，并且输出中不含凭据。真实迁移行为由
 * `test/integration/mysql-migration.integration.test.ts` 覆盖。
 */

describe("数据库迁移命令", () => {
  it("缺少 DATABASE_URL 时以非零状态退出且不回显配置值", async () => {
    const result = await runMigrate({
      ...process.env,
      DATABASE_URL: "",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("db.migrate.failed");
    expect(result.stderr).toContain("config-invalid:DATABASE_URL");
    expect(result.stdout).not.toContain("db.migrate.completed");
  });

  it("数据库不可达时以非零状态退出且不输出凭据", async () => {
    const result = await runMigrate({
      ...process.env,
      // 指向必然无人监听的本地端口，确定性地制造连接失败。
      DATABASE_URL:
        "mysql://migration_user:migration-super-secret@127.0.0.1:1/renewal_test",
      DATABASE_TLS_MODE: "disabled",
      DATABASE_ALLOW_INSECURE_TLS: "true",
      DATABASE_CONNECT_TIMEOUT_MS: "2000",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("db.migrate.failed");
    expect(result.stderr).toContain("migration-failed");
    expect(result.stderr).not.toContain("migration-super-secret");
    expect(result.stderr).not.toContain("mysql://");
    expect(result.stdout).not.toContain("db.migrate.completed");
  });
});
