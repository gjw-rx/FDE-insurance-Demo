## Context

当前 `apps/api` 是 Fastify 组合根，配置由 `src/config/api-config.ts` 读取，生命周期由 `src/bootstrap/application.ts` 与 `main.ts` 管理，会话仍使用 `InMemoryChatSessionStore`。本 change 只新增数据库基础设施，不改变现有会话仓储和业务路由；具体行为契约见 `specs/mysql-storage-foundation/spec.md`。

## Goals / Non-Goals

**Goals:**

- 在 `apps/api` 建立唯一的 MySQL 连接池、健康检查和关闭边界。
- 为云端环境提供显式 secret 配置、TLS、超时和连接池参数校验。
- 使用版本化迁移管理数据库基础，并让部署流程显式执行迁移。
- 通过隔离的真实 MySQL 集成测试验证安全边界、迁移幂等/互斥和资源生命周期。
- 同步 API、架构、技术、需求和测试计划文档。

**Non-Goals:**

- 不将 `InMemoryChatSessionStore` 替换为 MySQL 仓储。
- 不创建或迁移聊天、续保、报价、材料、用户、鉴权等业务表。
- 不实现 ORM 领域模型、业务 DAO、事务用例、跨重启恢复、备份恢复或读写分离。
- 不选择具体云厂商、托管数据库产品或生产网络拓扑。
- 不在 API 启动时自动执行迁移。

## Decisions

### 1. 在 API 基础设施层使用 `mysql2` + Drizzle 迁移能力

- 生产依赖采用 `mysql2@3.24.4` 与 `drizzle-orm@0.45.2`；开发依赖采用 `drizzle-kit@0.31.10`，版本以 2026-09-19 读取到的 registry 版本为基线，已固定写入 `apps/api/package.json` 和根 `pnpm-lock.yaml`。
- `mysql2` 提供 Node.js ESM 下的连接池和参数化查询边界；Drizzle 只用于类型安全的数据库连接封装和版本化迁移，不在本 change 建立任何业务 schema。
- 选择该组合而不是仅手写 `mysql2` 迁移脚本，是为了避免自行维护迁移顺序、journal 和 SQL 结构差异；选择它而不是重量更大的全功能数据访问框架，是因为当前没有业务模型，且应用/domain 包不得依赖数据库。
- 所有数据库实现只放在 `apps/api/src/infrastructure/database/`；`packages/domain`、`packages/application` 和 `packages/contracts` 不增加数据库依赖。

### 2. 连接信息与 TLS 使用显式运行配置

- 使用 secret provider 注入的 `DATABASE_URL` 作为连接地址；补充 `DATABASE_TLS_MODE`、可选的 CA 文件路径以及连接/查询/池大小等非敏感配置。
- 生产部署必须使用证书校验模式；关闭 TLS 只能通过明确的非生产配置启用。连接字符串永远不写入启动摘要、错误、日志或测试证据。
- 配置解析保持现有 `ApiConfigError` 模式：只暴露字段名和校验规则，测试覆盖缺失、非法协议、边界和 TLS 组合。

### 3. 连接池由组合根装配，迁移由发布命令执行

- `createApiApp` 通过可注入的数据库依赖装配默认 MySQL 客户端，单元测试可注入 fake；不在 application/domain 层创建全局单例。
- `/health/live` 继续只表示进程存活；新增独立 readiness 路由执行有界 `SELECT 1` 往返并返回脱敏的 200/503 结果。
- 关闭顺序为停止新工作、等待现有协调器收敛、关闭 Fastify、最后关闭连接池；close 操作幂等。
- 增加显式迁移脚本（例如 `db:migrate`），脚本启动数据库级互斥锁后调用迁移器，释放锁并以真实退出码结束。API 启动不调用该脚本，避免多副本同时启动时隐式改库。
- 初始迁移只创建迁移元数据/版本记录所需结构；不加入任何业务表、索引或业务数据。

### 4. 测试分层并保护生产边界

- 配置解析、健康路由和生命周期使用 Vitest 单元/应用测试，默认不连接真实数据库；通过 fake database 注入验证故障映射。
- 新增显式数据库集成测试命令，使用隔离的非生产 MySQL 实例（实测目标为 MySQL 8.0.27）。测试启动前要求目标库名带有明确的测试标识，且**只读取 `DATABASE_TEST_URL`、不回退运行时 `DATABASE_URL`**，拒绝未证明为非生产的目标。
- 集成测试覆盖真实 `SELECT 1`、参数化值、迁移首次/重复执行、并发迁移互斥、失败退出码和 pool close；不把密码、完整 URL 或材料/业务数据写入日志。
- `verify:api` 保持不隐式依赖真实数据库；`verify:change` 增加显式的 MySQL 集成前置条件和证据路径，确保普通单元测试与外部服务测试可区分。

### 5. 文档与架构事实同步

- 新增 `docs/tech/mysql.md`，记录 `mysql2`、Drizzle 及迁移工具版本、配置入口、TLS、迁移和验证方法；若后续确定云厂商，再单独增加对应 `docs/impl/`，本 change 不绑定厂商。
- 新增 `docs/features/mysql-storage-foundation.md` 与 `docs/testing/introduce-mysql-storage.md`，分别作为需求入口和测试计划/证据载体。
- 更新 `apps/api/README.md`、`docs/arch/system-design.md` 及必要的架构图源/产物，明确数据库基础已接入但业务数据仍未迁移。

## Risks / Trade-offs

- [MySQL 不可用] → API 进程仍可报告存活但 readiness 为不可用；连接和查询使用有界超时，不做无限重试，并保留脱敏诊断。
- [云厂商 TLS/连接参数差异] → 实测目标 MySQL 使用自动生成的自签证书：`verify-identity` 因 `self-signed certificate in certificate chain` 握手失败，且自动生成证书的主机名不匹配连接 IP，无法直接通过系统信任链完成校验。因此非生产环境采用显式豁免 `DATABASE_TLS_MODE=disabled` + `DATABASE_ALLOW_INSECURE_TLS=true`，生产环境仍由代码强制拒绝关闭校验；接入受信证书链（CA 文件或匹配域名的证书）后再切回 `verify-identity`。
- [MySQL DDL 非完全事务化] → 当前只做空业务基线；迁移命令串行化、失败即非零退出，复杂业务 schema 迁移另建 change 并单独设计回滚/前向修复。
- [连接池泄漏或关闭竞态] → 连接池由组合根拥有，close 幂等并纳入生命周期测试；不向业务层暴露可绕过的全局连接。
- [误连生产数据库] → 集成测试强制测试标识和独立凭据；文档与命令明确禁止复用云端生产连接，证据中只保留脱敏目标摘要。
- [依赖版本与 TypeScript 7/Node 24 兼容性] → 安装后执行 API typecheck、集成测试和锁文件检查；若 registry 基线版本不兼容，先在 change 内调整依赖组合，不绕过类型检查。

## Migration Plan

1. 先合入依赖、配置解析、连接池和 readiness，但保持现有内存会话仓储。
2. 在隔离数据库执行空基线迁移并验证重复执行；在发布流水线中把迁移作为 API 副本启动前的显式步骤。
3. 部署 API，让云平台只依据 `/health/ready` 接收流量，并继续以 `/health/live` 判断进程是否存活。
4. 若需回滚代码，停止新版本并回滚 API；本 change 的空基线迁移不包含业务结构，通常无需降级数据库。迁移失败时阻止发布，不标记为成功。
5. 后续首次引入业务表或替换会话仓储时，另建 change，明确数据模型、迁移兼容窗口、并发一致性、恢复与旧数据策略。

## Open Questions

无。云厂商、业务 schema 和是否将会话迁移到数据库均不影响本 change 的契约，按后续 change 决定。
