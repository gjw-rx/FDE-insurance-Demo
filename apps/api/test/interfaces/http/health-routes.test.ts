import { describe, expect, it } from "vitest";
import { createApiApp } from "../../../src/bootstrap/application.js";
import type { DatabaseReadiness } from "../../../src/infrastructure/database/mysql-database.js";
import { InMemoryChatSessionStore } from "../../../src/infrastructure/persistence/in-memory-chat-session-store.js";
import { createFakeDatabase } from "../../support/fake-database.js";

/**
 * 健康与就绪路由测试。
 *
 * 使用 Fastify `inject` 与数据库替身：不连接真实数据库也能覆盖就绪、连接失败与
 * 查询超时三种映射，并断言响应不包含内部地址、凭据或驱动错误细节。
 * 注入数据库替身时必须显式注入会话仓储：生产路径不会回退到内存仓储。
 */

function createApp(readiness?: DatabaseReadiness) {
  const database = createFakeDatabase(
    readiness === undefined ? {} : { readiness },
  );
  const app = createApiApp({
    database,
    sessionStore: new InMemoryChatSessionStore(),
  });
  return { app, database };
}

describe("健康路由", () => {
  it("存活探针只表示进程存活，不依赖数据库", async () => {
    const { app } = createApp({ ready: false, reason: "connect-failed" });

    const response = await app.server.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("数据库可用时就绪探针返回 ready", async () => {
    const { app } = createApp({ ready: true });

    const response = await app.server.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", reasons: [] });
  });

  it("数据库不可达时就绪探针返回未就绪且可重试", async () => {
    const { app } = createApp({ ready: false, reason: "connect-failed" });

    const response = await app.server.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "not-ready",
      reasons: ["DATABASE_UNREACHABLE"],
    });
  });

  it("数据库超时时给出可区分的超时原因", async () => {
    const { app } = createApp({ ready: false, reason: "timeout" });

    const response = await app.server.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "not-ready",
      reasons: ["DATABASE_TIMEOUT"],
    });
  });

  it("就绪响应只含稳定字段，不含内部地址、凭据或驱动错误", async () => {
    const { app } = createApp({ ready: false, reason: "connect-failed" });

    const response = await app.server.inject({
      method: "GET",
      url: "/health/ready",
    });
    const body = response.json<Record<string, unknown>>();

    expect(Object.keys(body).sort()).toEqual(["reasons", "status"]);

    // 替身的目标是 fake-db:3306/renewal_test：任何片段都不应出现在响应中。
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("fake-db");
    expect(serialized).not.toContain("3306");
    expect(serialized).not.toContain("renewal_test");
    expect(serialized).not.toContain("password");
  });
});
