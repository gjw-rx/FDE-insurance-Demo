# MySQL 存储基础

> Feature：`mysql-storage-foundation`

## 背景与用户目标

项目计划部署在云端，后续会话、续保案件、报价与材料等业务数据需要稳定的持久化基础。在引入任何业务功能之前，先把 MySQL 连接、配置校验、迁移和就绪检查这套基础固定下来，可以避免后续每个业务能力各自引入不一致的连接方式、迁移策略和失败语义。

本需求关注的是「基础设施可用且可验证」，而不是任何具体的业务读写。

## 范围

- 业务 API 从运行环境注入 MySQL 连接信息，并在启动阶段严格校验结构、TLS、连接池与超时边界。
- 连接池由组合根拥有，具有受控生命周期与幂等关闭。
- 进程存活与数据库就绪分离：`/health/live` 不访问依赖，`/health/ready` 执行有界数据库往返。
- 版本化迁移与显式迁移命令，带数据库级互斥、幂等与非零失败退出。
- 通过隔离的非生产 MySQL 实例验证连接、参数化查询、迁移幂等与互斥、连接池关闭。
- 会话业务表（`chat_session`、`chat_message`、`chat_run`）的结构、受控取值、迁移与真实 MySQL 验证已由 change [`persist-chat-sessions-with-mysql`](../../openspec/changes/archive/2026-09-21-persist-chat-sessions-with-mysql/) 以 delta spec 扩展本需求并交付。

## 非目标

- 本需求自身不创建业务表：会话业务表由上述已归档 change 扩展；续保案件、报价、材料、用户与鉴权结构仍不属于本需求。
- `InMemoryChatSessionStore` 到数据库仓储的替换同样由上述已归档 change 负责，本需求不定义会话读写行为。
- 不提供通用 ORM 领域模型、备份恢复或读写分离。
- 不在 API 进程启动时自动执行迁移。
- 不绑定具体云厂商或托管数据库产品。

## OpenSpec 关联

- 主 spec：[spec.md](../../openspec/specs/mysql-storage-foundation/spec.md)
- 已归档 change：[2026-09-21-persist-chat-sessions-with-mysql](../../openspec/changes/archive/2026-09-21-persist-chat-sessions-with-mysql/)
- Delta spec（归档留档）：[spec.md](../../openspec/changes/archive/2026-09-21-persist-chat-sessions-with-mysql/specs/mysql-storage-foundation/spec.md)（新增逻辑枚举与取值单一来源，修改迁移与真实 MySQL 验证要求）
- 已归档 change：[`2026-09-20-introduce-mysql-storage`](../../openspec/changes/archive/2026-09-20-introduce-mysql-storage/)
- Delta spec（归档留档）：[spec.md](../../openspec/changes/archive/2026-09-20-introduce-mysql-storage/specs/mysql-storage-foundation/spec.md)
- 测试计划：[introduce-mysql-storage.md](../testing/introduce-mysql-storage.md)
- 技术资料：[MySQL](../tech/mysql.md)

## 维护说明

可测试行为以 OpenSpec 为准，任务状态以已归档 change 的 `tasks.md` 为准（归档后不再变更）。本页只维护需求背景、边界和关联入口。

后续首次引入业务表或替换会话仓储时，按独立 change 明确数据模型、迁移兼容窗口、并发一致性、恢复策略与旧数据处理方式；已完成的部分见 [2026-09-21-persist-chat-sessions-with-mysql](../../openspec/changes/archive/2026-09-21-persist-chat-sessions-with-mysql/)，表结构约束以 [`.agents/rules/database-schema-design.md`](../../.agents/rules/database-schema-design.md) 为准。
