import {
  bigint,
  char,
  datetime,
  index,
  json,
  longtext,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * 聊天会话领域的三张业务表定义。
 *
 * 结构、字段注释与约束均已通过 change `persist-chat-sessions-with-mysql` 的人工
 * review（见该 change 的 design.md「候选 DDL」与「DDL Review 记录」）：
 *
 * - 无外键：关联完整性由仓储事务、唯一约束和启动校验承担。
 * - 无 `ENUM`、无取值校验约束：受控取值使用逻辑枚举（字符串 + `VARCHAR`），
 *   取值合法性由应用层在写库前按 `@renewal/contracts` 校验。
 * - 每表字段数少于 30、索引数少于 5，索引名称显式声明。
 *
 * 已知限制：本仓库的 `drizzle-orm@0.45.2` 不支持列注释 API，因此字段与表的中文
 * 注释只存在于迁移 SQL 内（`apps/api/drizzle/*.sql`），不在此处重复维护。
 *
 * 时间字段统一使用 `datetime(..., { fsp: 3, mode: "string" })`：时间戳由应用层
 * 以 UTC 写入，仓储负责在 ISO 8601 与 MySQL 的可接受格式之间转换，避免依赖
 * 数据库服务器时钟与时区。
 */

/** 会话摘要；列表排序键为 (updated_at DESC, session_id DESC)。 */
export const chatSession = mysqlTable(
  "chat_session",
  {
    sessionId: char("session_id", { length: 36 }).primaryKey(),
    title: varchar("title", { length: 60 }).notNull(),
    titleSource: varchar("title_source", { length: 20 }).notNull(),
    createdAt: datetime("created_at", { fsp: 3, mode: "string" }).notNull(),
    updatedAt: datetime("updated_at", { fsp: 3, mode: "string" }).notNull(),
    /** 下一条消息的会话内序号；由事务内的 session 行锁分配。 */
    nextMessageOrder: bigint("next_message_order", {
      mode: "number",
      unsigned: true,
    })
      .notNull()
      .default(1),
  },
  (table) => [
    index("idx_chat_session_updated").on(table.updatedAt, table.sessionId),
  ],
);

/** 会话消息；顺序由 message_order 决定。 */
export const chatMessage = mysqlTable(
  "chat_message",
  {
    messageId: char("message_id", { length: 36 }).primaryKey(),
    sessionId: char("session_id", { length: 36 }).notNull(),
    runId: char("run_id", { length: 36 }).notNull(),
    messageOrder: bigint("message_order", {
      mode: "number",
      unsigned: true,
    }).notNull(),
    role: varchar("role", { length: 16 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    text: longtext("text").notNull(),
    createdAt: datetime("created_at", { fsp: 3, mode: "string" }).notNull(),
  },
  (table) => [
    // 一个 run 最多一条用户消息和一条助手消息；同时是重复提交的幂等键。
    uniqueIndex("uq_chat_message_run_role").on(table.runId, table.role),
    index("idx_chat_message_session_order").on(
      table.sessionId,
      table.messageOrder,
    ),
  ],
);

/** run 的幂等与终态记录；重启恢复据此收敛遗留状态。 */
export const chatRun = mysqlTable(
  "chat_run",
  {
    runId: char("run_id", { length: 36 }).primaryKey(),
    sessionId: char("session_id", { length: 36 }).notNull(),
    agentName: varchar("agent_name", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    snapshotJson: json("snapshot_json"),
    createdAt: datetime("created_at", { fsp: 3, mode: "string" }).notNull(),
    updatedAt: datetime("updated_at", { fsp: 3, mode: "string" }).notNull(),
    finishedAt: datetime("finished_at", { fsp: 3, mode: "string" }),
    abortReason: varchar("abort_reason", { length: 20 }),
    errorCode: varchar("error_code", { length: 80 }),
  },
  (table) => [
    index("idx_chat_run_session_status").on(table.sessionId, table.status),
    index("idx_chat_run_status_updated").on(table.status, table.updatedAt),
  ],
);
