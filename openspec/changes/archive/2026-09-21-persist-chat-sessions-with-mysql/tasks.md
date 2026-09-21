## 1. DDL Review Gate

- [x] 1.1 将 `design.md` 中的三表候选 DDL 提交用户 review，记录批准/修改结论、评审日期和最终字段清单，并包含用户已确认的「去掉 `CHECK` 取值约束、统一逻辑枚举、禁止写死取值」；在获得明确批准前不得创建业务 Drizzle schema、生成迁移或执行任何 DDL，验证方式为 change 评审记录中存在明确结论且 `apps/api/drizzle/` 无新增业务迁移；证据：`design.md`「DDL Review 记录」记录 2026-09-20 三轮评审结论与批准范围（评审当时无业务迁移，未执行过 DDL）
- [x] 1.2 若 review 修改表名、字段、约束、索引或排序方案，先同步 `proposal.md`、delta specs、`design.md` 和本任务清单，再重新核对无外键、无 `ENUM` 类型与 `CHECK` 取值清单、snake_case、每表少于 30 列、每表索引少于 5 个；验证方式为静态 SQL 检查和人工清单逐项通过；证据：候选 DDL 删除 5 个 `CHECK` 约束后已同步全部产物，静态检查确认三表 6/8/10 列、2/3/3 索引、字段全为 snake_case

## 2. Schema 与迁移

- [x] 2.1 在 review 批准后使用已锁定的 `drizzle-orm@0.45.2` 与 `drizzle-kit@0.31.10` 建立三表 Drizzle schema，验证 `packages/domain`、`packages/application`、`packages/contracts` 未新增数据库依赖且 API typecheck 通过；证据：`drizzle/chat-schema.ts` + `drizzle/schema.ts` 汇总导出，`corepack pnpm --filter @renewal/api typecheck` 退出码 0，三个包均无数据库依赖
- [x] 2.2 生成追加业务迁移并在迁移 SQL 内补齐已批准的中文 `COMMENT` 子句，人工检查无 `FOREIGN KEY`、无 `ENUM` 类型、无 `CHECK` 取值清单、不含写死的取值列表、字段均为下划线命名、每表列数和索引数满足限制；验证迁移文件与批准版 DDL 逐字段一致，且 `corepack pnpm docs:check` 能识别直接依赖技术文档；证据：`drizzle/0001_chat_session_tables.sql`（24 个列注释 + 3 个表注释，显式 ENGINE/CHARSET/COLLATE），静态检查无外键/ENUM/CHECK
- [x] 2.3 查询 `information_schema.columns` / `information_schema.tables` 校验已应用库中三表每个字段与表的中文注释真实存在且与批准版一致；验证注释覆盖率 100%，不依赖应用代码或文档副本；证据：`.runtime/harness/persist-chat-sessions-with-mysql/2.3-schema-evidence.txt`（注释覆盖 8/8、10/10、6/6，外键 0、CHECK 0、enum 字段 0）及 `test/integration/mysql-chat-schema.integration.test.ts`
- [x] 2.4 在隔离 MySQL 8.0.27 上从空库和上一版本空基线库执行首次、重复、并发和失败迁移；验证 `corepack pnpm --filter @renewal/api test:integration` 与迁移集成测试真实退出码符合预期，失败不写入完成记录；证据：`2.4-integration.log`（退出 0）、`2.4-empty-and-failure.txt`（空库首次退出 0 且 2 条版本记录；冲突表场景退出 1、业务版本未记录、`chat_message` 未创建）、`2.4-mysql-version.txt`（MySQL 8.0.27，`utf8mb4_0900_ai_ci`）

## 3. MySQL 会话仓储

- [x] 3.1 实现 `MySqlChatSessionStore` 并接入 `ChatSessionStore`，覆盖创建、查询、重命名、游标列表和按消息序号读取；验证仓储单元测试和真实 MySQL 查询测试通过，异常统一为稳定存储错误；证据：`mysql-chat-session-store.ts` + `chat-session-repository.integration.test.ts`（8 用例真实库通过）
- [x] 3.2 实现用户消息/run 的事务性幂等写入，使用 session 行锁分配 `message_order`，保证自动标题、会话更新时间、消息和 run 一致提交；验证重复 `runId`、跨会话复用、模拟中途失败和 SQL 元字符输入测试通过；证据：`chat-session-idempotency.integration.test.ts`（重复 runId、跨会话拒绝、超出列宽触发整体回滚、SQL 元字符、终态只收敛一次）
- [x] 3.3 实现助手消息创建、增量追加、终态收敛和快照序列化，保证同一 run/role 不重复、终态不被覆盖；验证既有 `chat-session-store` 行为测试迁移到 MySQL 实现并通过；证据：`chat-session-idempotency.integration.test.ts` 助手消息与快照用例 + `test/application/chat/chat-session-store.test.ts` 端口契约
- [x] 3.4 将生产组合根默认仓储替换为 MySQL 实现，测试路径继续显式注入内存/fake 仓储；验证 API 路由、SSE、幂等和存储不可用测试通过，且无静默内存回退；证据：`application.ts` 的 `resolveSessionStore`、`application-lifecycle.test.ts`「注入数据库替身但未注入会话仓储时明确失败」、`lifecycle.test.ts` 数据库不可达时的 503 脱敏断言
- [x] 3.5 在 `@renewal/contracts` 为受控取值提供运行时单一来源（取值数组为唯一事实来源，联合类型从其派生），仓储与应用服务写入前校验取值、读取到契约外取值时返回稳定错误；验证非法取值写入被拒、未知库值不透传且取值清单在仓库中只有一处定义；证据：contracts 取值数组（含 `AGENT_RUN_STATUSES`、`AGENT_SERVICE_ERROR_CODES` 等）+ `chat-value-validation.test.ts` + `chat-session-controlled-values.integration.test.ts`

## 4. 重启恢复与生命周期

- [x] 4.1 增加启动恢复检查，将遗留 `accepted`、`running` 和 `streaming` 记录以事务收敛为失败/中断语义，恢复只处理非终态并且不启动 Agent；验证恢复测试和重复恢复幂等测试通过；证据：`recoverInterruptedRuns` + `chat-session-recovery.integration.test.ts`（收敛计数、幂等、不改写会话更新时间）
- [x] 4.2 将恢复检查接入 API 生命周期并保持迁移不在启动时隐式执行；验证 API 重启集成测试能恢复历史、不会重复启动 run，数据库不可用时 readiness/写操作语义保持脱敏且可定位；证据：`ApiApp.recover()` 由 `listen` 调用且未调用迁移；`chat-session-recovery.integration.test.ts`「API 组合根启动恢复…不重新启动 Agent」断言 agent 调用次数为 0
- [x] 4.3 验证关闭顺序、连接池释放和恢复失败边界；运行 `corepack pnpm verify:api`，确认活动 run 收敛、重复 close 无副作用、无未关闭数据库连接；证据：`verify:api` 退出码 0；`application-lifecycle.test.ts` 关闭幂等与连接池归还；恢复失败只记录 `chat.recovery.failed` 不阻止进程存活

## 5. 规则与文档同步

- [x] 5.1 新增 `.agents/rules/database-schema-design.md`，固化 DDL 先 review、禁止外键、禁止 `ENUM`/代码枚举类与 `CHECK` 写死取值、逻辑枚举取值单一来源、索引少于 5 个、单表少于 30 列、snake_case 命名和字段必须有中文注释的规则；验证规则文件符合 `.agents/rules` 格式且后续任务引用该规则；证据：规则文件已创建并在 `.agents/README.md` 登记，tasks 1.2/2.2/2.3 与 `docs/tech/mysql.md` 引用其约束
- [x] 5.2 更新 `docs/tech/mysql.md`、`apps/api/README.md`、`docs/arch/system-design.md` 及必要架构图源，说明 Drizzle 业务 schema、三表边界、事务和恢复；验证链接、版本和实际实现位置一致；证据：三份文档已同步（含 `dateStrings`、集成用例表、事实来源表）、架构图重新交付（9/9 检查通过、visual-check pass、4 个视口），`docs:check` 退出码 0
- [x] 5.3 更新 `docs/features/chat-session-management.md` 与 `docs/features/mysql-storage-foundation.md`，关联本 change、delta spec 和测试计划，移除“会话仍为内存/不跨重启”的过时事实；验证 `corepack pnpm docs:check` 通过；证据：两个 feature 已链接活动 change 与 delta spec，`corepack pnpm docs:check` 退出码 0（36 个 Markdown、1 个活动 change）
- [x] 5.4 创建 `docs/testing/persist-chat-sessions-with-mysql.md`，映射每个 requirement/scenario、隔离数据库前置条件、DDL review 证据、命令、实际退出码和未覆盖项；验证未执行项明确标记，未将预期结果写成通过；证据：测试计划含全部 scenario 映射、真实验证记录与「未覆盖项」，`docs:check` 结构检查通过

## 6. 收尾验证

- [x] 6.1 运行受影响的 API typecheck、单元测试、真实 MySQL 集成测试、格式检查和 OpenSpec 严格校验；验证所有命令真实退出码为 0，失败保留完整日志到 `.runtime/harness/`；证据：typecheck 退出 0、`test` 15 文件/124 用例 0、`test:integration` 7 文件/38 用例 0、`format:check` 0、`openspec validate --strict` 通过，日志在 `.runtime/harness/persist-chat-sessions-with-mysql/`
- [x] 6.2 运行 `corepack pnpm verify:change persist-chat-sessions-with-mysql`，核对会话重启恢复、幂等、事务回滚、无外键/索引/列数限制和敏感信息脱敏证据；验证 change tasks、测试计划与实现状态一致；证据：`verify:change` 退出码 0（harness 自测、typecheck、全量 test、真实库集成、web build、Playwright 42 项、docs:check、format:check、OpenSpec 严格校验共 9 步全 PASS，summary 见 `.runtime/harness/1789906817009-eecc4945/summary.json`）
