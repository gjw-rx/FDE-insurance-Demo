/**
 * 数据库 schema 定义入口。
 *
 * drizzle-kit 只读取本文件；业务表定义按领域拆分在同目录的单个文件内并在此汇总
 * 导出，新增领域时新增一个 `*-schema.ts` 文件并追加导出，不在此文件内联表定义。
 *
 * change `introduce-mysql-storage` 只引入连接与迁移基础设施，因此当时本文件为空导出；
 * 本次 change（`persist-chat-sessions-with-mysql`）开始引入会话领域的三张业务表。
 * 字段与表的中文注释只维护在迁移 SQL 内（`drizzle-orm@0.45.2` 无列注释 API），
 * 表结构约束见 `.agents/rules/database-schema-design.md`。
 */
export * from "./chat-schema.js";
