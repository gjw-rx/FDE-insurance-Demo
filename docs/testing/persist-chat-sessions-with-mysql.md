# persist-chat-sessions-with-mysql 测试计划

> 状态：通过（除下方「未覆盖项」明确列出的范围）；change 已于 2026-09-21 归档。

## 关联资料

- Change（已归档）：[`2026-09-21-persist-chat-sessions-with-mysql/`](../../openspec/changes/archive/2026-09-21-persist-chat-sessions-with-mysql/)
- 需求与 specs：[chat-session-management](../features/chat-session-management.md) → [delta spec](../../openspec/changes/archive/2026-09-21-persist-chat-sessions-with-mysql/specs/chat-session-management/spec.md)；[mysql-storage-foundation](../features/mysql-storage-foundation.md) → [delta spec](../../openspec/changes/archive/2026-09-21-persist-chat-sessions-with-mysql/specs/mysql-storage-foundation/spec.md)
- 设计（含候选 DDL 与 DDL Review 记录）：[design.md](../../openspec/changes/archive/2026-09-21-persist-chat-sessions-with-mysql/design.md)
- 表结构规则：[`.agents/rules/database-schema-design.md`](../../.agents/rules/database-schema-design.md)
- 技术资料：[MySQL](../tech/mysql.md)
- 相关已归档 change：[introduce-mysql-storage](../../openspec/changes/archive/2026-09-20-introduce-mysql-storage/)、[add-chat-session-management](../../openspec/changes/archive/2026-09-19-add-chat-session-management/)

## 测试范围

测试层次与外部依赖：

- **结构检查（人工 + 脚本）**：DDL 评审门禁证据；迁移 SQL 中无 `FOREIGN KEY`、无 `ENUM` 类型、无 `CHECK` 取值清单、字段为 `snake_case`、每表字段数少于 30、索引数少于 5。
- **结构查询验证（真实 MySQL）**：`test/integration/mysql-chat-schema.integration.test.ts` 查询 `information_schema.columns` / `tables` / `statistics` / `table_constraints`，核对字段类型、中文注释、索引与禁用项。
- **API 单元测试（Vitest，无数据库）**：受控取值读写校验、仓储端口契约、错误映射、组合根无内存回退、进程生命周期；数据库以替身注入，不连接真实 MySQL。
- **API 集成测试（Vitest + 隔离 MySQL 8.0.27）**：迁移首次/重复/并发/失败、空库与基线库两条路径、事务与幂等、游标分页、重启恢复、受控取值边界。
- **API 生命周期与 E2E**：`listen` 触发恢复、关闭顺序与连接池释放；Playwright 使用 fake Agent 验证会话流程在 MySQL 持久化下行为不变。

前置条件与数据：

- 集成测试仅使用 `DATABASE_TEST_URL`（不回退运行时 `DATABASE_URL`），目标库名必须含 `test`；无该变量时集成测试整体跳过并输出原因，**跳过不代表通过**。
- 实测目标为隔离的非生产 MySQL **8.0.27**（默认排序规则 `utf8mb4_0900_ai_ci`）。
- 集成测试串行执行文件，并在用例开始前清空 `chat_message` / `chat_run` / `chat_session`；空库与失败路径验证使用名字含 `test` 的临时库并在结束前删除。
- 测试数据使用固定 36 位标识与固定基准时间戳；正文、标题与凭据不写入日志与证据文件。
- E2E 链路用例读取仓库根 `.env` 的 `DATABASE_TEST_URL`，未配置时跳过并给出原因。

## 场景覆盖

### chat-session-management（delta）

| Requirement / Scenario                                               | 测试层次   | 测试文件或用例                                                                                 | 状态 |
| -------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- | ---- |
| 会话数据跨 API 重启持久保存 / API 重启后恢复会话                     | API 集成   | `chat-session-repository.integration.test.ts`「新的仓储实例仍能读取已保存历史」                | 通过 |
| 会话数据跨 API 重启持久保存 / 存储不可用时拒绝写入                   | 进程级     | `test/bootstrap/lifecycle.test.ts`（数据库不可达时 503 + 稳定错误码与脱敏响应）                | 通过 |
| 会话数据跨 API 重启持久保存 / 读取不存在的持久化会话                 | API 集成   | `chat-session-repository.integration.test.ts`（返回 null / `CHAT_SESSION_NOT_FOUND`）          | 通过 |
| 会话写入必须保持消息与 run 的幂等一致性 / 重复 run 请求不重复落库    | API 集成   | `chat-session-idempotency.integration.test.ts`「相同 runId 重复提交只落库一次」                | 通过 |
| 会话写入必须保持消息与 run 的幂等一致性 / 跨会话复用 runId           | API 集成   | 同上「跨会话复用 runId 被拒绝，且不留下新的消息或 run」                                        | 通过 |
| 会话写入必须保持消息与 run 的幂等一致性 / 首条消息与自动标题一致提交 | API 集成   | 同上「首条消息与自动标题在同一事务内提交」+「中途写入失败时事务整体回滚」                      | 通过 |
| 重启恢复必须收敛遗留活动状态 / 遗留 streaming run 被收敛             | API 集成   | `chat-session-recovery.integration.test.ts`「遗留的非终态 run 与 streaming 消息被收敛」        | 通过 |
| 重启恢复必须收敛遗留活动状态 / 重启恢复重复执行                      | API 集成   | 同上「重复恢复是幂等的」+「API 组合根启动恢复…不重新启动 Agent」                               | 通过 |
| 既有会话管理行为保持不变（创建/摘要/详情/重命名/游标分页）           | 单元 + E2E | `test/application/chat/chat-session-store.test.ts`、`test/interfaces/http/*`、Playwright 42 项 | 通过 |

### mysql-storage-foundation（delta）

| Requirement / Scenario                                          | 测试层次      | 测试文件或用例                                                                        | 状态 |
| --------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------- | ---- |
| 受控取值必须使用逻辑枚举且保持单一来源 / 迁移不写死取值清单     | 结构检查      | 迁移 SQL 静态检查 + `mysql-chat-schema.integration.test.ts`（无 `ENUM`/`CHECK`）      | 通过 |
| 受控取值必须使用逻辑枚举且保持单一来源 / 非法取值在写库前被拒绝 | 单元          | `test/infrastructure/persistence/chat-value-validation.test.ts`                       | 通过 |
| 受控取值必须使用逻辑枚举且保持单一来源 / 读取到未知历史取值     | API 集成      | `chat-session-controlled-values.integration.test.ts`                                  | 通过 |
| 数据库结构必须通过版本化迁移管理 / 首次应用基线迁移             | 结构查询      | `mysql-chat-schema.integration.test.ts` + 空库首次迁移证据                            | 通过 |
| 数据库结构必须通过版本化迁移管理 / 重复执行迁移                 | API 集成      | `mysql-migration.integration.test.ts`「重复执行迁移是幂等的」                         | 通过 |
| 数据库结构必须通过版本化迁移管理 / 并发执行迁移                 | API 集成      | 同上「并发执行迁移由数据库互斥串行化」                                                | 通过 |
| 数据库结构必须通过版本化迁移管理 / 迁移失败                     | 单元 + 真实库 | `test/bootstrap/migrate-command.test.ts` + 冲突表失败迁移证据（非零退出、不记录版本） | 通过 |
| 数据库结构必须通过版本化迁移管理 / 未经 review 的 DDL 被阻止    | 流程证据      | `design.md`「DDL Review 记录」+ tasks 1.1                                             | 通过 |
| 数据库边界必须可通过真实 MySQL 验证 / 参数化查询隔离输入        | API 集成      | `mysql-infrastructure.integration.test.ts` + 元字符标题/正文用例                      | 通过 |
| 数据库边界必须可通过真实 MySQL 验证 / 测试环境与生产隔离        | 单元          | `test/support/database-test-target.test.ts`                                           | 通过 |
| 数据库边界必须可通过真实 MySQL 验证 / 会话事务边界              | API 集成      | `chat-session-idempotency.integration.test.ts`（回滚、幂等、跨会话拒绝）              | 通过 |

## 验证记录

| 日期       | 命令 / 动作                                                                                | 实际结果                                                                                                                                            | 证据                                                                            |
| ---------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 2026-09-20 | `corepack pnpm --filter @renewal/api exec drizzle-kit generate --name chat_session_tables` | 退出码 0：生成 `0001_chat_session_tables.sql`，工具报告 3 表 / 0 外键                                                                               | `apps/api/drizzle/`                                                             |
| 2026-09-20 | 迁移 SQL 静态检查                                                                          | 无 `FOREIGN KEY`/`ENUM`/`CHECK`；列数 6/8/10；索引 2/3/3；字段全 `snake_case`；24 列注释 + 3 表注释                                                 | `.runtime/harness/persist-chat-sessions-with-mysql/`（终端输出）                |
| 2026-09-20 | `corepack pnpm --filter @renewal/api typecheck`                                            | 退出码 0                                                                                                                                            | `6.1-typecheck.log`                                                             |
| 2026-09-20 | `corepack pnpm --filter @renewal/api test`                                                 | 退出码 0：15 个文件 / 124 个用例通过（不访问真实数据库）                                                                                            | `6.1-unit.log`                                                                  |
| 2026-09-20 | `corepack pnpm --filter @renewal/api test:integration`                                     | 退出码 0：7 个文件 / 38 个用例通过（隔离库 `renewal_test` @ MySQL 8.0.27）                                                                          | `6.1-integration.log`                                                           |
| 2026-09-20 | 临时库空库首次迁移 + 冲突表失败迁移                                                        | 空库：退出码 0、2 条版本记录、3 张业务表、外键+CHECK 为 0；失败：退出码 1、`db.migrate.failed`、业务版本未记录、`chat_message` 未创建；临时库已删除 | `2.4-empty-and-failure.txt`、`2.4-mysql-version.txt`                            |
| 2026-09-20 | `information_schema` 独立结构核验                                                          | 注释覆盖 8/8、10/10、6/6；外键 0、CHECK 0、enum 字段 0；索引名称与列顺序与批准版一致；版本记录 2 条                                                 | `2.3-schema-evidence.txt`                                                       |
| 2026-09-20 | `corepack pnpm exec playwright test`                                                       | 退出码 0：42 项通过（含真实 API + fake Agent + 隔离库的链路用例）                                                                                   | `6.1-playwright.log`                                                            |
| 2026-09-20 | `corepack pnpm docs:check`                                                                 | 退出码 0：36 个 Markdown、1 个活动 change、19 个直接依赖                                                                                            | 终端输出                                                                        |
| 2026-09-20 | `openspec validate persist-chat-sessions-with-mysql --strict`                              | 有效：change 校验通过                                                                                                                               | 终端输出                                                                        |
| 2026-09-20 | `corepack pnpm verify:api`                                                                 | 退出码 0：typecheck 与单元测试全 PASS                                                                                                               | `6.2-verify-api.log`、`.runtime/harness/1789906702877-9cf01fdf/summary.json`    |
| 2026-09-20 | `corepack pnpm verify:change persist-chat-sessions-with-mysql`                             | 退出码 0：harness 自测、typecheck、全量 test、真实库集成、web build、Playwright、docs:check、format:check、OpenSpec 严格校验共 9 步全 PASS          | `6.2-verify-change.log`、`.runtime/harness/1789906817009-eecc4945/summary.json` |
| 2026-09-20 | Archify `validate` / `deliver` / `visual-check`                                            | 9/9 检查通过、0 错误 0 警告；交付 HTML 成功；可视化检查 `pass`（1440×900、1600×1000、1920×1080、2048×1320）                                         | `artifacts/architecture/system-architecture.visual-check.json` 等               |

## 未覆盖项

- `verify:identity` TLS 模式仍受自签证书限制（沿用上一 change 的既知限制）：本 change 未改变 TLS 行为，也未在受信证书链上验证。
- 多 API 写实例并发写入与跨实例恢复协调不在本 change 范围：实现只保证单实例写入；跨实例一致性未覆盖且不承诺。
- 既有内存仓储数据到 MySQL 的迁移未覆盖：内存数据不跨进程导出，属于已确认非目标。
- 生产环境发布流程（含 `db:migrate` 在真实发布流水线中的编排）未执行：本 change 只验证迁移命令自身的退出码与幂等语义。
- 断线续接（浏览器携带 cursor 重连）未实现，属既有非目标，本 change 未新增覆盖。
