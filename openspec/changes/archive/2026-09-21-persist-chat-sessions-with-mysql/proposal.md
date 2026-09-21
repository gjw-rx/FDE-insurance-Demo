## Why

当前聊天会话、消息和 run 记录仍由 `InMemoryChatSessionStore` 保存，API 重启后数据全部丢失，也无法满足已记录的跨重启恢复与幂等收敛要求。上一 change 已引入 MySQL、`mysql2` 与 Drizzle 基础设施，本次需要在既有技术栈上建立经评审的业务表和数据库仓储，使 MySQL 成为会话数据的唯一生产事实来源。

## What Changes

- 沿用并正式使用已安装的 `drizzle-orm@0.45.2`、`drizzle-kit@0.31.10` 与 `mysql2@3.24.4`，不再引入第二套 ORM；补充 Drizzle 业务 schema、类型安全查询与事务边界。
- 为 `chat_session`、`chat_message`、`chat_run` 拟定三表 DDL，全部使用下划线字段名、不使用外键、每表少于 30 列且索引少于 5 个。
- 将候选 DDL 先写入 `design.md` 供人工评审；在获得明确批准前，禁止生成迁移文件、执行 DDL 或改动数据库结构。
- 实现 MySQL 会话仓储并将其设为 API 生产默认实现；保留仓储端口与测试替身，移除生产路径对进程内会话存储的依赖。
- 使用事务和唯一约束保证用户消息、run 记录、自动标题与会话更新时间的一致写入，并维持 `run_id` 幂等语义和稳定游标分页。
- API 启动后识别并收敛数据库中遗留的非终态 run/消息，避免重启后永久显示 `streaming` 或重复启动 Agent run。
- 数据库不可读写时拒绝相关会话操作并返回现有脱敏稳定错误，不静默回退到内存存储；数据库 readiness 继续反映真实可用性。
- 同步 `docs/features/chat-session-management.md`、`docs/features/mysql-storage-foundation.md`、`docs/testing/persist-chat-sessions-with-mysql.md`、`docs/tech/mysql.md`、API README、架构文档及必要图源。
- 在 `.agents/rules/` 新增数据库表结构规则，固化“DDL 先评审”、禁用外键、索引数量、列数和 snake_case 命名要求。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `chat-session-management`: 增加会话、消息与 run 的 MySQL 持久化、API 重启恢复、遗留非终态记录收敛以及存储不可用时禁止静默降级的行为要求；对应需求文档为 `docs/features/chat-session-management.md`。
- `mysql-storage-foundation`: 将版本化迁移从空业务基线扩展为经人工评审后创建会话业务表，并要求业务查询、事务与迁移通过隔离的真实 MySQL 验证；对应需求文档为 `docs/features/mysql-storage-foundation.md`。

## Impact

- 受影响代码：`apps/api` 的 Drizzle schema、迁移、MySQL 连接暴露边界、会话仓储实现、组合根、启动恢复与数据库集成测试。
- 公开 HTTP/SSE DTO 与路由保持兼容；生产会话数据从进程内状态改为 MySQL 持久化，API 重启后的可观察行为发生变化。
- 依赖影响：不新增 ORM 或数据库驱动，继续使用已锁定的 Drizzle/MySQL 依赖；实现后更新现有 `docs/tech/mysql.md` 的业务使用说明。
- 数据影响：新增三张业务表；当前内存数据无法跨进程读取，因此不提供旧数据迁移。数据库迁移必须先经过 DDL 人工评审，再由发布阶段显式执行。
- 运维影响：生产会话接口依赖 MySQL 可写；数据库异常时服务保持存活但不可就绪，相关操作返回脱敏可重试错误，不使用内存后备。
- 规则影响：新增 `.agents/rules/` 数据库设计约束，后续所有 DDL 变更均需在生成迁移和执行前完成 review。
