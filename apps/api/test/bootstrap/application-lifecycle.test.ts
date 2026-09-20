import { describe, expect, it } from "vitest";
import { createApiApp } from "../../src/bootstrap/application.js";
import { createFakeDatabase } from "../support/fake-database.js";

/**
 * 组合根关闭顺序与幂等性测试。
 *
 * 使用数据库替身记录关闭次数：真实数据库不参与，但「进程退出前必须归还连接池」
 * 与「重复关闭不重复释放」是可以在组合根层面验证的行为。
 */

describe("API 组合根生命周期", () => {
  it("关闭时归还数据库连接池，且重复关闭只归还一次", async () => {
    const database = createFakeDatabase();
    const app = createApiApp({ database });
    await app.listen();

    await app.close();
    expect(database.closeCount()).toBe(1);

    await app.close();
    expect(database.closeCount()).toBe(1);
  });

  it("关闭后不再接受新的 HTTP 连接", async () => {
    const database = createFakeDatabase();
    const app = createApiApp({ database });
    const address = await app.listen();

    const before = await fetch(`${address}/health/live`);
    expect(before.status).toBe(200);

    await app.close();
    expect(database.closeCount()).toBe(1);

    // 服务已关闭：新连接必须失败，而不是继续被接受。
    await expect(fetch(`${address}/health/live`)).rejects.toThrow();
  });

  it("数据库未就绪只影响就绪状态，不影响进程存活", async () => {
    const database = createFakeDatabase({
      readiness: { ready: false, reason: "connect-failed" },
    });
    const app = createApiApp({ database });
    const address = await app.listen();

    try {
      const live = await fetch(`${address}/health/live`);
      const ready = await fetch(`${address}/health/ready`);

      expect(live.status).toBe(200);
      expect(ready.status).toBe(503);
      await expect(ready.json()).resolves.toEqual({
        status: "not-ready",
        reasons: ["DATABASE_UNREACHABLE"],
      });
    } finally {
      await app.close();
    }
  });
});
