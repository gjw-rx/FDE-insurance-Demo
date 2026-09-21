import type {
  DatabaseReadiness,
  MySqlDatabase,
} from "../../src/platform/database/mysql_database.js";

/**
 * 数据库替身。
 *
 * 默认报告就绪，可指定未就绪原因；记录关闭次数，用于断言组合根的关闭顺序与
 * 幂等性。使用替身时组合根不会读取 `DATABASE_URL`，也不会建立任何连接。
 */
export interface FakeDatabase extends MySqlDatabase {
  readonly closeCount: () => number;
}

export function createFakeDatabase(
  options: { readonly readiness?: DatabaseReadiness } = {},
): FakeDatabase {
  const readiness: DatabaseReadiness = options.readiness ?? { ready: true };
  let closedCount = 0;

  return {
    target: "fake-db:3306/renewal_test",
    checkReadiness: async () => readiness,
    close: async () => {
      closedCount += 1;
    },
    closeCount: () => closedCount,
  };
}
