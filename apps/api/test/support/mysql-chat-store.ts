import {
  chatMessage,
  chatRun,
  chatSession,
} from "../../drizzle/chat-schema.js";
import type { DatabaseConfig } from "../../src/config/database-config.js";
import type { MySqlQueryHandle } from "../../src/infrastructure/database/mysql-database.js";
import { createMySqlDatabase } from "../../src/infrastructure/database/mysql-database.js";
import { MySqlChatSessionStore } from "../../src/infrastructure/persistence/mysql-chat-session-store.js";

/**
 * 集成测试用的 MySQL 会话仓储。
 *
 * 直接在隔离测试库上打开真实连接池与仓储，并提供 `reset()` 清理三张会话表：
 * 集成测试串行执行文件，因此测试可以独占这些表。清理顺序按引用方向（消息 → run →
 * 会话），不使用外键级联。
 */
export interface TestChatStore {
  readonly store: MySqlChatSessionStore;
  /**
   * Drizzle 句柄：少数用例需要绕过仓储直接写库，以模拟「人工写入或旧版本遗留」
   * 的非法取值。
   */
  readonly db: MySqlQueryHandle;
  /** 清空三张会话表；每个用例开始时调用，保证断言不受前一个用例影响。 */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export function openTestChatStore(config: DatabaseConfig): TestChatStore {
  const database = createMySqlDatabase(config);
  const db = database.db;
  if (db === undefined) {
    throw new Error("真实数据库句柄缺少 Drizzle 句柄");
  }
  const store = new MySqlChatSessionStore({ db });
  return {
    store,
    db,
    reset: async () => {
      await db.delete(chatMessage);
      await db.delete(chatRun);
      await db.delete(chatSession);
    },
    close: () => database.close(),
  };
}
