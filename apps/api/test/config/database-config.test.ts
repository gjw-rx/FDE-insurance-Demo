import { describe, expect, it } from "vitest";
import {
  describeDatabaseTarget,
  loadDatabaseConfig,
} from "../../src/config/database-config.js";

/**
 * MySQL 连接配置测试。
 *
 * 关注三类行为：合法配置的解析结果、不安全或非法配置在启动阶段被拒绝，
 * 以及失败信息不泄露连接地址、用户名或密码。
 */

const VALID_URL =
  "mysql://renewal_user:renewal_password@mysql.internal:3307/renewal";

describe("loadDatabaseConfig", () => {
  it("默认启用 TLS 校验，并使用有界的连接池与超时默认值", () => {
    expect(loadDatabaseConfig({ env: { DATABASE_URL: VALID_URL } })).toEqual({
      target: { host: "mysql.internal", port: 3307, database: "renewal" },
      credentials: { user: "renewal_user", password: "renewal_password" },
      tls: { mode: "verify-identity", caFilePath: undefined },
      pool: {
        connectionLimit: 10,
        queueLimit: 20,
        connectTimeoutMs: 5_000,
        queryTimeoutMs: 10_000,
      },
    });
  });

  it("未指定端口时使用 MySQL 默认端口 3306", () => {
    expect(
      loadDatabaseConfig({
        env: { DATABASE_URL: "mysql://user:password@mysql.internal/renewal" },
      }).target.port,
    ).toBe(3306);
  });

  it("缺少 DATABASE_URL 时拒绝启动", () => {
    expect(() => loadDatabaseConfig({ env: {} })).toThrow(/DATABASE_URL/);
    expect(() => loadDatabaseConfig({ env: { DATABASE_URL: "   " } })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("拒绝非 mysql 协议、带查询参数或无法解析的连接地址", () => {
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: "postgres://user:password@host:5432/renewal" },
      }),
    ).toThrow(/mysql:/);
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: `${VALID_URL}?ssl-mode=DISABLED` },
      }),
    ).toThrow(/查询参数/);
    expect(() =>
      loadDatabaseConfig({ env: { DATABASE_URL: "not-a-connection-url" } }),
    ).toThrow(/DATABASE_URL/);
    // 非特殊协议下 `@` 后直接跟空主机：URL 解析本身即失败，同样被拒绝。
    expect(() =>
      loadDatabaseConfig({ env: { DATABASE_URL: "mysql://user:pw@/renewal" } }),
    ).toThrow(/DATABASE_URL/);
  });

  it("拒绝缺少主机、库名、用户名或密码的连接地址", () => {
    expect(() =>
      loadDatabaseConfig({ env: { DATABASE_URL: "mysql:/renewal" } }),
    ).toThrow(/主机名/);
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: "mysql://user:pw@mysql.internal:3306" },
      }),
    ).toThrow(/数据库名/);
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: "mysql://:pw@mysql.internal:3306/renewal" },
      }),
    ).toThrow(/用户名/);
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: "mysql://user@mysql.internal:3306/renewal" },
      }),
    ).toThrow(/密码/);
  });

  it("拒绝非法端口与百分号转义", () => {
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: "mysql://user:pw@mysql.internal:0/renewal" },
      }),
    ).toThrow(/端口/);
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: "mysql://user:pw@mysql.internal:99999/renewal" },
      }),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: "mysql://user:pw@mysql.internal:3306/re%zz" },
      }),
    ).toThrow(/百分号转义/);
  });

  it("拒绝越界的连接池与超时配置", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["DATABASE_POOL_SIZE", "0"],
      ["DATABASE_POOL_SIZE", "999"],
      ["DATABASE_QUEUE_LIMIT", "-1"],
      ["DATABASE_QUEUE_LIMIT", "99999"],
      ["DATABASE_CONNECT_TIMEOUT_MS", "1.5"],
      ["DATABASE_QUERY_TIMEOUT_MS", "abc"],
    ];
    for (const [name, value] of cases) {
      expect(() =>
        loadDatabaseConfig({
          env: { DATABASE_URL: VALID_URL, [name]: value },
        }),
      ).toThrow(new RegExp(name));
    }
  });

  it("禁用 TLS 需要显式确认，且生产环境一律拒绝", () => {
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: VALID_URL, DATABASE_TLS_MODE: "disabled" },
      }),
    ).toThrow(/DATABASE_ALLOW_INSECURE_TLS/);

    expect(
      loadDatabaseConfig({
        env: {
          DATABASE_URL: VALID_URL,
          DATABASE_TLS_MODE: "disabled",
          DATABASE_ALLOW_INSECURE_TLS: "true",
          NODE_ENV: "test",
        },
      }).tls,
    ).toEqual({ mode: "disabled" });

    expect(() =>
      loadDatabaseConfig({
        env: {
          DATABASE_URL: VALID_URL,
          DATABASE_TLS_MODE: "disabled",
          DATABASE_ALLOW_INSECURE_TLS: "true",
          NODE_ENV: "production",
        },
      }),
    ).toThrow(/生产环境/);

    expect(() =>
      loadDatabaseConfig({
        env: {
          DATABASE_URL: VALID_URL,
          DATABASE_TLS_MODE: "disabled",
          DATABASE_ALLOW_INSECURE_TLS: "true",
          DATABASE_CA_FILE: "/etc/ssl/mysql-ca.pem",
        },
      }),
    ).toThrow(/DATABASE_CA_FILE/);
  });

  it("拒绝未知的 TLS 模式", () => {
    expect(() =>
      loadDatabaseConfig({
        env: { DATABASE_URL: VALID_URL, DATABASE_TLS_MODE: "preferred" },
      }),
    ).toThrow(/DATABASE_TLS_MODE/);
  });

  it("verify-identity 可携带自定义 CA，环境变量可覆盖池与超时", () => {
    const config = loadDatabaseConfig({
      env: {
        DATABASE_URL: VALID_URL,
        DATABASE_TLS_MODE: "verify-identity",
        DATABASE_CA_FILE: "/etc/ssl/mysql-ca.pem",
        DATABASE_POOL_SIZE: "5",
        DATABASE_QUEUE_LIMIT: "30",
        DATABASE_CONNECT_TIMEOUT_MS: "1500",
        DATABASE_QUERY_TIMEOUT_MS: "2500",
      },
    });

    expect(config.tls).toEqual({
      mode: "verify-identity",
      caFilePath: "/etc/ssl/mysql-ca.pem",
    });
    expect(config.pool).toEqual({
      connectionLimit: 5,
      queueLimit: 30,
      connectTimeoutMs: 1_500,
      queryTimeoutMs: 2_500,
    });
  });

  it("校验失败的错误不包含连接地址、用户名或密码", () => {
    const secretUrl =
      "mysql://renewal_user:super-secret-password@mysql.internal:0/renewal";
    let message = "";
    try {
      loadDatabaseConfig({ env: { DATABASE_URL: secretUrl } });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("super-secret-password");
    expect(message).not.toContain("renewal_user");
    expect(message).not.toContain("mysql.internal");
  });

  it("连接目标摘要不含凭据", () => {
    expect(
      describeDatabaseTarget({
        host: "mysql.internal",
        port: 3306,
        database: "renewal",
      }),
    ).toBe("mysql.internal:3306/renewal");
  });
});
