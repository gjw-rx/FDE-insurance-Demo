# introduce-mysql-storage 测试计划

> 状态：通过并已归档（单元与应用级、真实数据库集成、E2E 均通过；`verify:change` 退出 0）

## 关联资料

- Change（已归档）：[2026-09-20-introduce-mysql-storage](../../openspec/changes/archive/2026-09-20-introduce-mysql-storage/)
- 需求与 specs：[mysql-storage-foundation](../features/mysql-storage-foundation.md) · [主 spec](../../openspec/specs/mysql-storage-foundation/spec.md) · [delta spec（归档留档）](../../openspec/changes/archive/2026-09-20-introduce-mysql-storage/specs/mysql-storage-foundation/spec.md)
- 技术资料：[MySQL](../tech/mysql.md)

## 测试范围

**层次划分**

| 层次           | 范围                                                         | 是否访问真实数据库   |
| -------------- | ------------------------------------------------------------ | -------------------- |
| 单元           | 配置解析与校验、就绪原因映射、迁移失败分类、集成测试安全护栏 | 否                   |
| 应用（inject） | 健康路由、组合根装配与关闭顺序、既有会话路由回归             | 否（注入数据库替身） |
| 进程           | API 启动摘要与 SIGTERM 退出、迁移命令退出码                  | 否                   |
| 集成（真实库） | 连接往返、参数化查询、就绪、迁移首次/幂等/并发、业务表不存在 | 是                   |

**前置条件与测试数据**

- 单元与应用级：无需凭据。数据库通过 `apps/api/test/support/fake-database.ts` 注入，不建立任何连接。
- 集成级：仓库根 `.env` 中设置 `DATABASE_TEST_URL`，指向**非生产** MySQL（库名需包含 `test`；本次实测为 `renewal_test`，与运行时库 `renewal` 分离，两库由本 change 新建且起始为空）；如需例外必须显式设置 `DATABASE_TEST_ALLOW_MUTATION=true`。
- TLS：实测目标使用自动生成的自签证书，`verify-identity` 握手因 `self-signed certificate in certificate chain` 失败；非生产按显式豁免使用 `DATABASE_TLS_MODE=disabled` + `DATABASE_ALLOW_INSECURE_TLS=true`（生产环境会被代码拒绝启动）。证书链可用后应切回 `verify-identity` 复验。
- 安全护栏：集成测试只读取 `DATABASE_TEST_URL`，**绝不回退**到运行时 `DATABASE_URL`；未设置或无法证明为非生产库时整体跳过并输出原因，不计为通过。
- 外部服务替身：Agent 服务在应用级测试中不参与；迁移并发用例通过并行启动两个真实迁移子进程验证，不使用替身。

## 场景覆盖

| Requirement / Scenario                                | 测试层次  | 测试文件或用例                                                                               | 状态 |
| ----------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- | ---- |
| R1 配置必须安全且可验证 / 使用有效云端配置            | 单元      | `test/config/database-config.test.ts`（默认与覆盖用例）                                      | 通过 |
| R1 / 缺少数据库连接信息                               | 单元+进程 | `test/config/database-config.test.ts`、`test/bootstrap/migrate-command.test.ts`              | 通过 |
| R1 / 拒绝不安全或非法配置                             | 单元      | `test/config/database-config.test.ts`（协议、端口、边界、TLS 组合）                          | 通过 |
| R2 连接具有受控生命周期 / 服务正常关闭                | 应用      | `test/bootstrap/application-lifecycle.test.ts`、`test/bootstrap/lifecycle.test.ts`           | 通过 |
| R2 / 数据库连接超时                                   | 单元      | `test/infrastructure/database/mysql-database.test.ts`（不可达端口）                          | 通过 |
| R3 存活与就绪必须分离 / 数据库可用时服务就绪          | 应用      | `test/interfaces/http/health-routes.test.ts`（替身就绪）                                     | 通过 |
| R3 / 数据库可用时服务就绪（真实库）                   | 集成      | `test/integration/mysql-infrastructure.integration.test.ts`                                  | 通过 |
| R3 / 数据库不可用时服务未就绪                         | 应用      | `test/interfaces/http/health-routes.test.ts`、`test/bootstrap/application-lifecycle.test.ts` | 通过 |
| R4 结构必须通过版本化迁移管理 / 首次应用基线迁移      | 集成      | `test/integration/mysql-migration.integration.test.ts`                                       | 通过 |
| R4 / 重复执行迁移                                     | 集成      | `test/integration/mysql-migration.integration.test.ts`                                       | 通过 |
| R4 / 并发执行迁移                                     | 集成      | `test/integration/mysql-migration.integration.test.ts`                                       | 通过 |
| R4 / 迁移失败                                         | 进程      | `test/bootstrap/migrate-command.test.ts`                                                     | 通过 |
| R5 边界必须可通过真实 MySQL 验证 / 参数化查询隔离输入 | 集成      | `test/integration/mysql-infrastructure.integration.test.ts`                                  | 通过 |
| R5 / 测试环境与生产隔离                               | 单元      | `test/support/database-test-target.test.ts`                                                  | 通过 |
| 契约：未就绪原因穷举                                  | 编译期    | `packages/contracts/test/health-contract-coverage.ts`                                        | 通过 |

## 验证记录

| 日期       | 命令                                                   | 实际结果                                                                           | 证据                                                   |
| ---------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-09-20 | `corepack pnpm --filter @renewal/contracts typecheck`  | 退出 0                                                                             | 终端输出                                               |
| 2026-09-20 | `corepack pnpm --filter @renewal/contracts test`       | 退出 0（含 health 契约穷举表）                                                     | 终端输出                                               |
| 2026-09-20 | `corepack pnpm --filter @renewal/api typecheck`        | 退出 0                                                                             | 终端输出                                               |
| 2026-09-20 | `corepack pnpm --filter @renewal/api test`             | 退出 0；14 个文件 / 114 个用例通过                                                 | 终端输出                                               |
| 2026-09-20 | `corepack pnpm --filter @renewal/api test:integration` | 退出 0；2 个文件 / **7 个用例全部通过**（真实 MySQL 8.0.27）                       | 终端输出                                               |
| 2026-09-20 | `corepack pnpm --filter @renewal/api db:migrate`       | 退出 0；输出 `db.migrate.completed` 与脱敏目标                                     | 终端输出                                               |
| 2026-09-20 | 迁移结果库内核对（只读）                               | `renewal` / `renewal_test` 各只有 `__drizzle_migrations`（1 条记录），业务表命中 0 | 终端输出                                               |
| 2026-09-20 | `corepack pnpm verify:harness`                         | 退出 0                                                                             | `.runtime/harness/1789884809304-41bf1e00/summary.json` |
| 2026-09-20 | `corepack pnpm verify:api`                             | 退出 0；2 步 PASS                                                                  | `.runtime/harness/1789885251342-8ec76f1a/summary.json` |
| 2026-09-20 | `corepack pnpm verify:change introduce-mysql-storage`  | 退出 0；9 步全部 PASS；集成步骤 13870ms **真实执行**（非跳过）                     | `.runtime/harness/1789892896088-c4e3f0f3/summary.json` |

真实数据库用例已全部执行：连接往返、参数化查询、真实就绪、迁移首次应用/幂等/并发互斥、业务表不存在。运行库与测试库为 `renewal` 与 `renewal_test`（本 change 新建，起始为空）。

**环境事实**：目标服务器为 MySQL **8.0.27**（非规划时的 8.4），使用自动生成的自签证书。

**过程中发现并修复的两个真实问题**：

1. **首轮 `verify:change` 真实失败**：`tests/e2e/chat-pipeline.spec.ts` 会启动真实 API 进程，`DATABASE_URL` 改为必填后该进程启动失败（`api failed to start: DATABASE_URL 必填`）。已为该用例补充指向不可达本地端口的数据库配置（该用例不访问数据库，连接池创建是惰性的），复跑 42 个 E2E 用例全部通过。
2. **`.env` 空值行陷阱**：`DATABASE_CA_FILE=`（等号后有尾随空格）被 Node 的 `loadEnvFile` 解析为“吞掉下一行”，使 CA 路径变成 `DATABASE_POOL_SIZE=10` 且该变量丢失，导致 API 启动直接失败。已改为整行注释模板。

## 未覆盖项

1. **TLS `verify-identity` 无法在当前目标上成立**：实测服务器使用自动生成的自签证书，`verify-identity` 握手报 `self-signed certificate in certificate chain`；且自动证书主机名与连接 IP 不匹配，即使提供 CA 也无法通过主机名校验。当前非生产按显式豁免使用 `disabled`。要在该实例上真正启用证书校验，需先更换为匹配域名的受信证书（或限定到可校验主机名的内网端点），属后续环境工作。
2. **`disabled` 模式下凭据在网络上不加密**：这是当前非生产配置的既定取舍，生产环境由代码强制拒绝该组合。切回 `verify-identity` 前，生产部署不得使用此配置。
3. **迁移失败后的部分应用状态未验证**：MySQL DDL 隐式提交，迁移中途失败时已执行的语句不会回滚。当前基线迁移无 DDL，未覆盖该情形；首次引入业务表迁移时必须单独设计并验证。
4. **既有 harness 缺陷已一并修复**：`.agents/harness/verify.mjs` 的 `verify()` 中原先直接 `JSON.parse(readFileSync(historyPath))`，history 文件损坏时会抛未捕获的 SyntaxError。该行在 `HEAD` 中逐字存在，属本 change 之外的既有代码；由于任务 3.4 已修改该文件，经确认后一并修复为「按空历史降级」，并新增「失败历史文件损坏时按空历史处理」用例覆盖（`corepack pnpm verify:harness` 退出 0）。
5. **既有库的 schema 漂移风险（已通过选址规避）**：目标服务器上原有的 `ai_agent`（10 张表）与 `ai_training`（6 张表）并非由 drizzle 管理，将迁移指向它们会产生漂移。经确认改用本 change 新建的空库 `renewal` / `renewal_test`；若后续需要接管既有库，必须先产出与现状对齐的基线。
6. **harness 自动格式化反复破坏 prettier 合规**：pi-lens 的回合末格式化会写出非 2 空格缩进，使 `format:check` 反复失败（已记录，每次编辑后需重跑 `corepack pnpm format`）。
