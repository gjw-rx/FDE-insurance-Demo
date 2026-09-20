# MySQL

<!-- tech-packages: mysql2, drizzle-orm, drizzle-kit -->

> 状态：已引入；版本：mysql2 3.24.4、drizzle-orm 0.45.2、drizzle-kit 0.31.10

## 用途与选型

业务 API 需要 MySQL 连接与版本化迁移能力，为后续云端业务数据提供统一持久化基础。

- `mysql2` 提供 Node.js ESM 下的连接池与参数化查询边界。选择它而不是其他驱动，是因为它直接暴露连接池参数（`connectionLimit`、`queueLimit`、`connectTimeout`、`resetOnRelease`）和查询级 `timeout`，便于把「有界连接、有界等待」写成可验证的配置。
- `drizzle-orm` 提供迁移执行器（`drizzle-orm/mysql2/migrator`）。本 change 只用它应用迁移，不建立任何业务 schema，也不暴露查询抽象。
- `drizzle-kit` 是开发期迁移生成工具；业务表定义出现后再实际产出业务迁移。

选型细节与替代方案见已归档 change 的 [design.md](../../openspec/changes/archive/2026-09-20-introduce-mysql-storage/design.md)。

## 版本与使用位置

| 包            | 版本    | 依赖类型 | 使用位置                                                                  |
| ------------- | ------- | -------- | ------------------------------------------------------------------------- |
| `mysql2`      | 3.24.4  | 生产     | `apps/api/src/infrastructure/database/my-sql-database.ts`（连接池与就绪） |
| `drizzle-orm` | 0.45.2  | 生产     | `apps/api/src/infrastructure/database/migrate-database.ts`（迁移执行）    |
| `drizzle-kit` | 0.31.10 | 开发     | `apps/api/drizzle.config.ts`（迁移生成）                                  |

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
- 迁移使用单连接而非连接池：数据库级互斥锁（`GET_LOCK`）是连接级的，池会在不同连接间切换而无法保持锁。

## 验证与维护

```bash
corepack pnpm --filter @renewal/api typecheck
corepack pnpm --filter @renewal/api test
corepack pnpm --filter @renewal/api test:integration   # 需 DATABASE_TEST_URL
corepack pnpm --filter @renewal/api db:migrate         # 发布阶段显式执行
```

未配置 `DATABASE_TEST_URL` 时集成测试整体跳过并输出原因，此时**不代表**数据库行为已验证。

实测记录（2026-09-20）：目标为 MySQL **8.0.27**（非 8.4），已完成真实连接、只读就绪、参数化查询、迁移首次/幂等/并发互斥与连接池关闭验证，集成用例 7 项通过。该实例使用自动生成的自签证书，因此 `verify-identity` 握手报 `self-signed certificate in certificate chain`；非生产环境按显式豁免使用 `disabled`，生产环境要求接入受信证书链。

升级或移除时需要检查：驱动连接池参数名与默认值变化、`resetOnRelease` 支持情况、迁移器幂等判定方式（当前按 `created_at` 时间戳比较）、以及 TypeScript 版本对 `export type *` 等语法的支持。

## 资料

- [mysql2 文档](https://sidorares.github.io/node-mysql2/docs)
- [Drizzle ORM MySQL 文档](https://orm.drizzle.team/docs/get-started-mysql)
- [MySQL 8.0 参考手册](https://dev.mysql.com/doc/refman/8.0/en/)
