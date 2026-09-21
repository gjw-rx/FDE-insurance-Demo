# MySQL

<!-- tech-packages: mysql2, drizzle-orm, drizzle-kit -->

> 状态：已引入并承载会话业务数据；版本：mysql2 3.24.4、drizzle-orm 0.45.2、drizzle-kit 0.31.10

## 用途与选型

业务 API 需要 MySQL 连接与版本化迁移能力，为后续云端业务数据提供统一持久化基础。

- `mysql2` 提供 Node.js ESM 下的连接池与参数化查询边界。选择它而不是其他驱动，是因为它直接暴露连接池参数（`connectionLimit`、`queueLimit`、`connectTimeout`、`resetOnRelease`）和查询级 `timeout`，便于把「有界连接、有界等待」写成可验证的配置。
- `drizzle-orm` 提供类型安全查询、事务与迁移执行器（`drizzle-orm/mysql2/migrator`）。从 change `persist-chat-sessions-with-mysql` 超同时用于会话仓储的查询与事务：仓储用 `select ... for update` 锁定会话行分配消息顺序，用唯一键保证 run 幂等。
- `drizzle-kit` 是开发期迁移生成工具：`db:generate` 依 `drizzle/schema.ts` 生成迁移，生成后需按已评审的 DDL 补齐字段中文注释（见「业务 schema 与仓储」）。

选型细节与替代方案见已归档 change 的 [design.md](../../openspec/changes/archive/2026-09-20-introduce-mysql-storage/design.md)。

## 版本与使用位置

| 包            | 版本    | 依赖类型 | 使用位置                                                                                                                                                  |
| ------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mysql2`      | 3.24.4  | 生产     | `apps/api/src/infrastructure/database/mysql-database.ts`（连接池、就绪与 Drizzle 句柄）                                                                   |
| `drizzle-orm` | 0.45.2  | 生产     | `apps/api/src/infrastructure/database/migrate-database.ts`（迁移执行）、`apps/api/src/infrastructure/persistence/mysql-chat-session-store.ts`（会话仓储） |
| `drizzle-kit` | 0.31.10 | 开发     | `apps/api/drizzle.config.ts`（迁移生成）                                                                                                                  |

版本以 `apps/api/package.json` 和根 `pnpm-lock.yaml` 为准。迁移文件位于 `apps/api/drizzle/`，迁移入口为 `apps/api/src/bootstrap/migrate.ts`。

依赖边界：`packages/domain`、`packages/application`、`packages/contracts` 与 `apps/web` 均不依赖数据库驱动；数据库实现只存在于 `apps/api/src/infrastructure/database/`。

## 配置与约束

配置只从运行环境注入，`apps/api` 通过 `--env-file-if-exists=../../.env` 在本地读取仓库根 `.env`（该文件已被 `.gitignore` 忽略）。

| 变量                          | 默认值            | 说明                                                        |
| ----------------------------- | ----------------- | ----------------------------------------------------------- |
| `DATABASE_URL`                | 无（必填）        | `mysql://用户:密码@主机:端口/库名`；缺失即拒绝启动          |
| `DATABASE_TLS_MODE`           | `verify-identity` | 校验证书链与主机名；`disabled` 需显式豁免且生产环境一律拒绝 |
| `DATABASE_CA_FILE`            | 空                | 自签证书的 CA 文件路径；公有 CA 签发时留空                  |
| `DATABASE_ALLOW_INSECURE_TLS` | `false`           | 仅非生产允许关闭 TLS，需显式设为 `true`                     |
| `DATABASE_POOL_SIZE`          | 10                | 连接上限，1–50                                              |
| `DATABASE_QUEUE_LIMIT`        | 20                | 池耗尽时的排队上限，1–500                                   |
| `DATABASE_CONNECT_TIMEOUT_MS` | 5000              | 建连超时，1–60000                                           |
| `DATABASE_QUERY_TIMEOUT_MS`   | 10000             | 查询超时，1–120000                                          |

集成测试另用 `DATABASE_TEST_URL` 与 `DATABASE_TEST_ALLOW_MUTATION`，与运行时 `DATABASE_URL` 分离，避免测试误连运行库。详见[测试计划](../testing/introduce-mysql-storage.md)。

约束：

- 连接凭据只注入连接池，禁止写入源码、配置样例、日志、错误响应、SSE 或测试产物；启动摘要与就绪响应只含脱敏目标 `host:port/database`。
- 连接池启用 `resetOnRelease`，归还连接前重置用户变量、临时表与未结束事务，避免连接级状态污染下一个请求。mysql2 该项默认为 `false`。
- 连接池启用 `dateStrings: true`：`DATETIME(3)` 列按 UTC 挂钟值保存，而 mysql2 默认会把 DATETIME 解析成本地时区的 `Date`，会让读出的时刻随部署机器时区漂移；关闭驱动侧日期解析后，由仓储在 ISO 8601 与 MySQL 字面量之间显式转换。
- 迁移使用单连接而非连接池：数据库级互斥锁（`GET_LOCK`）是连接级的，池会在不同连接间切换而无法保持锁。
- `drizzle-orm` 不提供逐语句查询超时，业务查询超时依赖建连超时与连接池排队上限（`DATABASE_CONNECT_TIMEOUT_MS` / `DATABASE_QUEUE_LIMIT`）；需要硬超时时得在仓储层单独实现。

## 业务 schema 与仓储

从 change `persist-chat-sessions-with-mysql` 开始，数据库承载会话业务数据：

| 表             | 职责                         | 字段数 | 索引数 |
| -------------- | ---------------------------- | ------ | ------ |
| `chat_session` | 会话摘要与消息序号分配       | 6      | 2      |
| `chat_message` | 用户与助手消息、会话内顺序   | 8      | 3      |
| `chat_run`     | run 幂等键、Agent 快照与终态 | 10     | 3      |

来自 `.agents/rules/database-schema-design.md` 的硬约束：不使用外键、不使用 `ENUM` 类型与取值约束、每表字段数少于 30、索引数少于 5、字段与索引 `snake_case`、字段与表必须带中文注释；候选 DDL 必须先经人工评审再生成迁移。

实现要点：

- schema 定义在 `apps/api/drizzle/chat-schema.ts`，由 `drizzle/schema.ts` 汇总导出（`drizzle-kit` 只读后者）。
- **字段注释只能写在迁移 SQL 内**：本仓库的 `drizzle-orm@0.45.2` 的 `mysql-core` 不提供列注释 API，因此 `0001_chat_session_tables.sql` 由 `drizzle-kit generate` 生成后人工补齐 `COMMENT`、显式 `ENGINE/CHARSET/COLLATE` 与内联索引声明。后续生成新迁移时会重复出现未格式化的 `drizzle/meta/*.json` 与新 SQL，需重新格式化并人工检查；建议由评审环节一并确认。
- 受控取值（标题来源、消息角色、消息状态、run 状态、中断原因、Agent 错误码）的运行时定义只在 `@renewal/contracts` 的取值数组中维护一处；`apps/api/src/infrastructure/persistence/chat-value-validation.ts` 负责写入前拒绝与读取时的稳定错误映射。
- 写入都在事务内完成：用户消息与 run 为幂等写入，助手消息首个增量才创建，终态只收敛一次；消息顺序由 session 行锁分配。
- 启动恢复（`recoverInterruptedRuns`）只更新非终态记录，因此可重复执行，不重新启动 Agent，也不修改会话更新时间。

## 验证与维护

```bash
corepack pnpm --filter @renewal/api typecheck
corepack pnpm --filter @renewal/api test                 # 单元与应用级（不访问数据库）
corepack pnpm --filter @renewal/api test:integration      # 需 DATABASE_TEST_URL（隔离库）
corepack pnpm --filter @renewal/api db:generate           # 依 schema 生成迁移（生成后补齐注释并评审）
corepack pnpm --filter @renewal/api db:migrate            # 发布阶段显式执行
```

未配置 `DATABASE_TEST_URL` 时集成测试整体跳过并输出原因，此时**不代表**数据库行为已验证。

集成测试覆盖（`apps/api/test/integration/`）：

| 文件                                                 | 覆盖                                               |
| ---------------------------------------------------- | -------------------------------------------------- |
| `mysql-infrastructure.integration.test.ts`           | 真实连接、`SELECT 1`、参数化查询与连接池关闭       |
| `mysql-migration.integration.test.ts`                | 首次、重复、并发迁移与业务表集合                   |
| `mysql-chat-schema.integration.test.ts`              | 字段/类型/注释/索引与无外键无 `ENUM` 无 `CHECK`    |
| `chat-session-repository.integration.test.ts`        | 仓储读写、游标分页、消息顺序与跨实例读取           |
| `chat-session-idempotency.integration.test.ts`       | 重复 runId、跨会话复用、自动标题一致提交、事务回滚 |
| `chat-session-recovery.integration.test.ts`          | 重启恢复与幂等、组合根恢复不重启 Agent             |
| `chat-session-controlled-values.integration.test.ts` | 契约外取值的读取边界                               |

实测记录（2026-09-20）：目标为 MySQL **8.0.27**（非 8.4）。已完成会话三表的首次/重复/并发迁移、空库首次迁移、冲突表失败迁移（非零退出且不记录版本）、会话仓储事务与幂等、重启恢复、受控取值边界与连接池关闭验证；集成套件 7 个文件 / 38 个用例通过（另有 124 个不访问数据库的单元与应用级用例通过）。该实例使用自动生成的自签证书，因此 `verify-identity` 握手报 `self-signed certificate in certificate chain`；非生产环境按显式豁免使用 `disabled`，生产环境要求接入受信证书链。

升级或移除时需要检查：驱动连接池参数名与默认值变化、`resetOnRelease` 支持情况、迁移器幂等判定方式（当前按 `created_at` 时间戳比较）、以及 TypeScript 版本对 `export type *` 等语法的支持。

## 资料

- [mysql2 文档](https://sidorares.github.io/node-mysql2/docs)
- [Drizzle ORM MySQL 文档](https://orm.drizzle.team/docs/get-started-mysql)
- [MySQL 8.0 参考手册](https://dev.mysql.com/doc/refman/8.0/en/)
