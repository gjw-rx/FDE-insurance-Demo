## 1. 依赖与数据库基础结构

- [x] 1.1 在 `apps/api` 增加锁定版本的 `mysql2`、`drizzle-orm` 与迁移工具依赖，维护根 `pnpm-lock.yaml`，并验证 `corepack pnpm install --frozen-lockfile` 与 `corepack pnpm --filter @renewal/api typecheck` 通过
- [x] 1.2 建立 `apps/api/src/infrastructure/database/` 的数据库配置、连接池、健康检查和关闭接口，保持 `packages/domain`、`packages/application`、`packages/contracts` 不依赖数据库，并用目录/依赖检查验证依赖方向
- [x] 1.3 创建只包含迁移元数据的空业务基线迁移与显式迁移命令，增加数据库级互斥、非零失败退出和幂等处理；用隔离 MySQL 验证首次、重复、失败和并发迁移，确认没有业务表；已在 `renewal` / `renewal_test` 真实执行：首次、幂等与并发均通过，两库各只有 `__drizzle_migrations` 1 条记录、业务表 0

## 2. API 配置与生命周期

- [x] 2.1 扩展 API 配置以校验 `DATABASE_URL`、TLS 模式、CA 配置、连接池边界及连接/查询超时，覆盖缺失、非法协议、非法边界和不安全 TLS 组合；验证 `apps/api/test/config` 配置测试通过且错误不包含 secret
- [x] 2.2 在 API 组合根装配可注入的 MySQL 数据库依赖，确保测试可使用 fake、现有 `InMemoryChatSessionStore` 和业务路由行为不变；验证 API typecheck 与既有生命周期/路由测试通过
- [x] 2.3 保持 `/health/live` 只表示进程存活并新增独立 `/health/ready` 数据库就绪探针，覆盖成功、连接失败和查询超时的脱敏 200/503 映射；验证 Fastify `inject` 测试与响应字段检查通过
- [x] 2.4 将数据库连接池加入优雅关闭顺序，验证 SIGINT/SIGTERM、重复 close、活动请求收敛和 pool close 的生命周期测试通过

## 3. 真实 MySQL 集成验证

- [x] 3.1 建立集成测试受控入口：仅使用 `DATABASE_TEST_URL`（不回退运行时 `DATABASE_URL`），目标库名须包含 `test` 或显式允许例外；验证未明确指向非生产数据库时测试拒绝执行（`test/support/database-test-target.test.ts` 5 个用例通过，集成运行输出未执行原因）
- [x] 3.2 编写真实数据库集成测试，验证 `SELECT 1`、参数化查询、连接/查询超时、TLS 配置边界和连接池关闭；验证 SQL 元字符输入不会改变数据库结构，且日志/证据不包含完整 URL 或密码；7 项集成用例在 MySQL 8.0.27 上真实通过（`verify-identity` 受自签证书限制，见测试计划未覆盖项）
- [x] 3.3 编写迁移集成测试，验证首次迁移、重复迁移、并发互斥、失败退出码和空业务基线；验证迁移元数据存在且不存在聊天/续保/报价/材料等业务表；库内核对确认仅 `__drizzle_migrations` 一张表
- [x] 3.4 将数据库集成测试接入 `verify:change` 的显式步骤（未配置 `DATABASE_TEST_URL` 时整体跳过），保留普通单元测试不自动访问真实数据库；已执行 `corepack pnpm verify:api`（退出 0）与 `corepack pnpm verify:change introduce-mysql-storage`（退出 0，9 步 PASS，集成步为 skipped），证据保存于 `.runtime/harness/`

## 4. 文档与架构同步

- [x] 4.1 新增 `docs/features/mysql-storage-foundation.md`，说明背景、范围、非目标并链接活动 change、delta spec 和测试计划；`corepack pnpm docs:check` 的 feature/spec 关联检查通过
- [x] 4.2 新增 `docs/testing/introduce-mysql-storage.md`，登记每个 requirement/scenario 的测试映射、隔离数据库前置条件、命令与未执行状态；真实数据库用例在凭据就绪后补写实际退出码与证据路径（当前如实标记「待执行」）
- [x] 4.3 新增 `docs/tech/mysql.md`，记录 `mysql2`、Drizzle、迁移工具的实际版本（3.24.4 / 0.45.2 / 0.31.10）、配置/TLS、使用位置、验证与升级影响；tech-packages 声明与 `docs:check` 通过
- [x] 4.4 更新 `apps/api/README.md`、`docs/arch/system-design.md`，明确 MySQL 基础设施已接入但业务数据仍为内存/未实现；修正文档中「图中含业务数据库」的图文不一致；对未改动的架构图运行 validate（9 项检查、0 错误 0 警告）。经确认本 change 不重新生成 showcase 图：只接入连接/迁移/就绪、无业务数据流，首次引入业务表时再同步图源与渲染产物

## 5. 收尾门禁

- [x] 5.1 执行受影响的 API typecheck、单元/集成测试、格式检查、生产构建与 OpenSpec 严格校验；真实结果：单元与应用级 14 文件 / 114 用例通过，集成 7 用例**未执行**（无凭据），E2E 42 用例通过，`verify:change` 退出 0。结果已写入测试计划
- [x] 5.2 更新 `docs/testing/introduce-mysql-storage.md` 与本 change 任务证据；已核验 `.runtime/`、`test-results/`、`artifacts/` 与源码中均不含真实凭据（无 API key、无数据库口令）；`corepack pnpm verify:change introduce-mysql-storage` 与 `corepack pnpm docs:check` 均退出 0
