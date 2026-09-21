## Context

当前 API 已有 `mysql2` 连接池、Drizzle 迁移入口和 `ChatSessionStore` 应用端口，但生产默认仍是 `InMemoryChatSessionStore`。现有内存实现承载三类状态：会话摘要、消息顺序与正文、run 幂等及 Agent 快照；上一次 MySQL change 明确没有创建业务表。

本 change 的数据库实现只放在 `apps/api` 基础设施层，`packages/domain`、`packages/application` 和 `packages/contracts` 继续不依赖数据库驱动。现有 HTTP/SSE 形状保持兼容，重点是替换仓储实现并增加重启后的恢复边界。

## Goals / Non-Goals

**Goals:**

- 沿用已安装的 Drizzle/MySQL 技术栈，建立类型安全的三表业务 schema 和显式版本迁移。
- 在 DDL 生成和数据库执行前设置人工 review 门禁；本设计中的 SQL 仅为候选稿。
- 用 MySQL 事务、唯一约束和受控锁实现现有 `ChatSessionStore` 的幂等与一致性语义。
- API 重启后恢复已保存历史，并将无法续接的遗留活动 run 收敛为稳定失败/中断状态。
- 保持无外键、snake_case、每表少于 30 列、每表索引少于 5 个的结构约束。
- 通过隔离 MySQL 集成测试验证真实 SQL、事务回滚、迁移和恢复行为。

**Non-Goals:**

- 不引入新的 ORM、驱动、队列、缓存或鉴权系统；不支持多 API 写实例之间的分布式协作。
- 不把 Pi 内部 session 作为业务历史，不恢复已经无法续接的 Agent 流。
- 不迁移已有内存数据；内存数据不会跨进程导出，部署前需接受空数据库/已有数据库两种场景。
- 不在 API 启动时隐式执行 schema migration；发布阶段仍须显式执行迁移。
- 不在本次创建用户、续保、报价、材料等其他业务表。

## Decisions

### 1. ORM 选择：沿用 Drizzle，不重复引入框架

上一次 change 已锁定 `drizzle-orm@0.45.2`、`drizzle-kit@0.31.10` 和 `mysql2@3.24.4`。本次把 Drizzle 从“仅迁移基础设施”扩展为业务 schema 与 MySQL 查询使用：schema 放在 `apps/api/drizzle/schema.ts`，仓储放在 `apps/api/src/infrastructure/persistence/`，数据库连接和事务能力由 `apps/api/src/infrastructure/database/` 提供。

选择 Drizzle 而非 Prisma、TypeORM 或再次手写 SQL DAO 的原因是：依赖已经经过上一 change 的兼容验证；它能保留 MySQL 参数化查询和迁移边界；schema 类型可在 API 基础设施层生成，同时不污染 application/domain。替代方案会增加依赖、技术文档和迁移工具切换成本，本 change 不采纳。

### 2. 候选 DDL：三张表、无外键、低索引数量

以下是**候选 DDL review 稿，不是迁移文件，不得在用户确认前执行或生成迁移**。字段名全部使用下划线；时间由应用层写入 `DATETIME(3)`，避免依赖数据库服务器时钟造成测试和游标排序漂移。每个表的索引数量按包含主键/唯一索引计算，均小于 5。

```sql
CREATE TABLE chat_session (
  session_id CHAR(36) NOT NULL COMMENT '会话标识；由应用层生成的 UUID，仅作关联数据，不是访问凭证',
  title VARCHAR(60) NOT NULL COMMENT '会话标题；默认「新会话」，按 Unicode 码点截断至 60，不写入日志',
  title_source VARCHAR(20) NOT NULL COMMENT '标题来源：default 默认标题、first-message 首条消息自动命名、manual 用户手动；manual 后不再被新消息覆盖；库内不加取值约束，取值合法性由应用层校验',
  created_at DATETIME(3) NOT NULL COMMENT '创建时间；由应用层写入，不依赖数据库时钟',
  updated_at DATETIME(3) NOT NULL COMMENT '最近更新时间；会话内消息变更时刷新，列表按它倒序分页',
  next_message_order BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '下一条消息的会话内序号；事务内锁定本行分配，保证同会话消息顺序',
  PRIMARY KEY (session_id),
  KEY idx_chat_session_updated (updated_at, session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='聊天会话摘要；标题与更新时间用于历史列表分页';

CREATE TABLE chat_message (
  message_id CHAR(36) NOT NULL COMMENT '消息标识；由应用层生成的 UUID',
  session_id CHAR(36) NOT NULL COMMENT '所属会话标识；无外键，关联完整性由仓储事务保证',
  run_id CHAR(36) NOT NULL COMMENT '所属 run 标识；与 role 组成唯一键，保证一个 run 最多一条用户消息和一条助手消息',
  message_order BIGINT UNSIGNED NOT NULL COMMENT '会话内顺序号，从 1 开始；详情按它排序，不按时间戳或 ID 推断',
  role VARCHAR(16) NOT NULL COMMENT '消息角色：user 用户、assistant 助手；库内不加取值约束，取值合法性由应用层校验',
  status VARCHAR(20) NOT NULL COMMENT '消息状态：accepted 已接收、send-failed 发送失败、streaming 生成中、completed 完成、failed 失败；库内不加取值约束，取值合法性由应用层校验',
  text LONGTEXT NOT NULL COMMENT '消息正文；属敏感内容，禁止写入日志、SSE 错误和测试证据',
  created_at DATETIME(3) NOT NULL COMMENT '创建时间；由应用层写入',
  PRIMARY KEY (message_id),
  UNIQUE KEY uq_chat_message_run_role (run_id, role),
  KEY idx_chat_message_session_order (session_id, message_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='会话消息；顺序由 message_order 决定，正文不外泄';

CREATE TABLE chat_run (
  run_id CHAR(36) NOT NULL COMMENT 'run 标识；由应用层生成，重复提交以此幂等，不重复启动 Agent',
  session_id CHAR(36) NOT NULL COMMENT '所属会话标识；无外键，关联完整性由仓储事务保证',
  agent_name VARCHAR(100) NOT NULL COMMENT 'Agent 名称；取自 Agent 快照，仅用于诊断，不作为业务规则',
  status VARCHAR(20) NOT NULL COMMENT 'run 状态：accepted/running 为非终态，completed/failed/aborted 为唯一终态；库内不加取值约束，取值合法性由应用层校验',
  snapshot_json JSON NULL COMMENT 'Agent 快照 JSON；仅在 Agent 接受后写入，不参与查询过滤',
  created_at DATETIME(3) NOT NULL COMMENT '创建时间；由应用层写入',
  updated_at DATETIME(3) NOT NULL COMMENT '最近更新时间；重启恢复按它与 status 定位遗留非终态 run',
  finished_at DATETIME(3) NULL COMMENT '进入终态的时间；非终态为 NULL',
  abort_reason VARCHAR(20) NULL COMMENT '中断原因：requested 调用方请求、timeout 服务超时；仅 aborted 时写入；库内不加取值约束，取值合法性由应用层校验',
  error_code VARCHAR(80) NULL COMMENT '稳定错误码；仅 failed 时写入，不保存原始错误正文',
  PRIMARY KEY (run_id),
  KEY idx_chat_run_session_status (session_id, status),
  KEY idx_chat_run_status_updated (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Agent run 的幂等与终态记录；重启恢复据此收敛遗留状态';
```

**结构核对：** `chat_session` 6 个字段、2 个索引；`chat_message` 8 个字段、3 个索引；`chat_run` 10 个字段、3 个索引。三表均无 `FOREIGN KEY`、无 `ENUM` 类型、无取值校验约束。受控取值（标题来源、角色、消息状态、run 状态、中断原因）只用 `VARCHAR` 存逻辑取值，取值合法性由应用层在写库前按契约校验；DDL 不写死取值清单，因此取值新增或调整不需要改库结构。所有字段与表都带中文注释，注释只解释语义与约束来源，不记录敏感数据。`chat_session.next_message_order` 由事务内的 session 行锁分配消息顺序，使详情读取不依赖时间戳或随机 ID。

**注释的落地方式：** 本仓库安装的 `drizzle-orm@0.45.2` 的 `mysql-core` 不含列注释 API（已核对本地包，`mysql-core` 中不存在 `comment`），因此注释无法通过 Drizzle schema 表达。实现时由 `drizzle-kit` 生成迁移 SQL 后，在**该迁移文件内**补齐 `COMMENT` 子句再提交人工检查；不在 schema 或应用代码里另存一份注释文案，避免两处漂移。后续迁移若 `MODIFY` 到带注释的列，必须连同原注释一起重写，否则别名注释会被清除。

**待 review 项：** 需要确认表名、字段类型/长度、字段与表的中文注释文案、`snapshot_json` 是否接受完整 Agent 快照、`next_message_order` 的分配方式。用户已确认去掉 `CHECK` 取值约束，受控取值改由应用层校验；因此不再存在 `CHECK` 与 MySQL 版本的兼容性问题。已确认项：无外键、无枚举类型（`ENUM` 与代码枚举类均禁用）、逻辑枚举取值为单一来源、禁止写死取值清单。用户明确批准后，才可将该候选稿转成 Drizzle schema 和迁移；若 review 修改任一字段或注释，必须先更新本设计和 tasks，再生成迁移。

### 3. 仓储事务与无外键一致性

`MySqlChatSessionStore` 实现 `ChatSessionStore`，对外只返回应用层记录，并把驱动异常归一为 `CHAT_SESSION_STORE_UNAVAILABLE`；不存在记录仍映射为 `CHAT_SESSION_NOT_FOUND`。由于没有外键，所有关联完整性由仓储事务、唯一键和启动校验承担，不能依赖数据库级级联。

- 创建 session：插入摘要并初始化 `next_message_order`。
- 追加用户消息：事务内锁定 session 行，检查 `run_id`，为消息分配 `message_order`，插入 run 与用户消息，并在默认标题时同事务更新标题和 session 时间；重复 `run_id` 返回已有记录。
- 开始助手消息：锁定 run，分配下一个消息序号并插入唯一的 `(run_id, role=assistant)` 记录。
- 增量/终态：在事务内按 `run_id` 更新消息正文、状态、run 快照和 session 更新时间；终态更新只允许收敛一次，不覆盖已完成状态。
- 列表：按 `(updated_at DESC, session_id DESC)` 使用复合索引和游标条件分页。
- 详情：按 `(session_id, message_order)` 查询消息；启动时校验无孤立 run/message，发现损坏时记录脱敏诊断并拒绝写入，不删除未知数据。

事务超时、死锁、连接断开等驱动错误不得直接泄露；有限重试只允许针对明确可重试的死锁且有次数上限，业务重复提交依靠 `run_id` 唯一性而不是无限重试。

### 4. 启动恢复与生命周期

发布阶段先显式运行迁移，再启动 API。API 创建真实数据库句柄后执行一次有界恢复：锁定并把 `accepted`/`running` run 及其 `streaming` 助手消息标为失败/中断，补写 `finished_at`/`updated_at`，然后才允许服务对外接收新 run。恢复不调用 Agent，不重播 SSE，不把旧消息正文写入日志。

恢复操作应具备幂等条件：只更新非终态记录；重复执行不产生新消息。若恢复失败，API 可保持进程存活但不得声明会话服务可写就绪，且不能回退到内存仓储。关闭顺序沿用现有协调器、HTTP server、数据库连接池顺序。

### 5. DDL review 与迁移门禁

实现阶段第一项是建立 DDL review 记录：在 change 的 review 结论中记录用户批准的候选版本、修改项和日期。批准前只允许修改规划产物，不允许写 `apps/api/drizzle/schema.ts` 的业务表定义、不允许生成迁移、不允许执行 `db:migrate`。

批准后才按以下顺序实现：更新 schema 与迁移配置 → 生成并人工检查 SQL → 在隔离 MySQL 首次/重复/并发执行 → 接入 API 仓储。任何 schema 变更都必须重新走同一门禁；迁移命令继续由发布脚本显式触发。

### 6. 文档与规则同步

实现完成时更新 `docs/tech/mysql.md`，补充 Drizzle schema、仓储事务和三表限制；更新 `docs/arch/system-design.md` 及必要图源，标明 API 到 MySQL 的会话数据流；按模板新增 `docs/testing/persist-chat-sessions-with-mysql.md`；更新两个 feature 入口和 API README。新增 `.agents/rules/database-schema-design.md`，将本设计确认的 DDL review、无外键、索引/列数上限和 snake_case 规则固化为后续约束。

### 7. 受控取值使用逻辑枚举，取值定义保持单一来源

标题来源、消息角色、消息状态、run 状态和中断原因均属于受控取值。按用户确认的约束：数据库不使用 `ENUM` 类型，代码不使用枚举类，统一采用逻辑枚举（字符串取值 + `VARCHAR` 列），且 DDL 不写取值校验约束。

为了不把校验丢掉，且不违反“禁止写死”，取值的运行时定义只在 `@renewal/contracts` 维护一处（值数组为唯一事实来源，联合类型从值数组派生，避免类型和值两处漂移）；仓储与业务服务在写库前用该来源校验取值，非法取值在发生数据库副作用前被拒绝。`VARCHAR` 长度按契约中最大取值与未来扩展预留，取值新增只需改契约，不改库结构。

读取方向同样要处理异常数据：若库中被人工写入或旧版本遗留了契约外取值，仓储不得直接把未知取值当作正常结果透传给对外契约，而应返回稳定错误并保留脱敏诊断（沿用现有 `CHAT_SESSION_STORE_UNAVAILABLE` 语义），避免未知状态影响前端状态机。

选择该方案而不是保留 `CHECK` 或增加字典表的原因是：`CHECK` 会把取值清单写死在迁移里，字典表又需要外键或额外查询才能约束，两者都与“禁止外键、禁止写死”冲突。代价是数据库层不再拦截非法取值，因此必须有应用层校验测试和未知取值读取测试。

## Risks / Trade-offs

- [数据库不再拦截非法受控取值] → 取值的运行时定义只在 `@renewal/contracts` 保留一处，仓储写库前校验；单元测试覆盖非法取值被拒绝、未知库值不透传，集成测试用真实 SQL 验证列长度足以容纳合法取值。
- [无外键可能留下孤立记录] → 所有关联写入使用事务，run/message 使用唯一约束；启动和集成测试执行孤立记录扫描，发现损坏时拒绝写入而不静默修复。
- [按 session 行锁分配消息序号降低并发度] → 当前产品不支持多实例协作；锁只覆盖单次短事务，优先保证同一会话消息顺序。
- [助手增量频繁写 MySQL 造成写放大] → 仅更新当前助手消息正文和 session 时间；保留有界批量/节流实现空间，但不改变最终消息语义。
- [DDL review 延迟实现] → review 是显式前置任务；批准前不生成迁移，避免未经确认的结构进入数据库。
- [已有空基线迁移与业务迁移之间的版本差异] → 业务迁移只追加新版本，不修改或删除已记录迁移；在隔离库验证从空库和已有基线两条路径。
- [恢复过程中 API 崩溃] → 更新只针对非终态记录并在事务内完成；下次启动可安全重试，终态记录不被覆盖。
- [MySQL 版本与排序规则差异] → 以项目记录的 MySQL 8.0.27 为最低验证目标，排序规则固定为 `utf8mb4_0900_ai_ci`；生成迁移后在该版本执行真实集成测试，不以 SQLite 替代。
- [Drizzle 无法表达列注释导致后续迁移清除注释] → 注释只写在迁移 SQL 内并纳入人工检查；用 `information_schema.columns` 校验已应用结构的注释存在，后续 `MODIFY` 列时必须携带原注释。

## Migration Plan

1. **Review 阶段**：用户评审本文件候选 DDL；记录批准或修改结论。未批准时停止，不生成 schema/migration。
2. **实现阶段**：批准后增加 Drizzle 三表 schema，生成一份追加业务迁移；执行静态检查确认无 `FOREIGN KEY`，逐表确认列数和索引数限制。
3. **验证阶段**：在隔离 MySQL 中从空库和已完成上一次空基线的库分别执行迁移，验证首次、幂等、并发和失败退出；再验证仓储事务、恢复和 API 重启。
4. **发布阶段**：部署前显式执行 `db:migrate`，确认成功后启动新版 API；API 启动只执行恢复检查，不执行 schema migration。
5. **回滚阶段**：代码回滚不删除已创建的三表或已写入会话数据；回滚版本必须兼容新增表，数据库降级另建 change，不执行破坏性 `DROP`。

## DDL Review 记录

| 日期       | 评审内容         | 结论与落实                                                                                                                                                                                                |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-20 | 首次提交候选 DDL | 用户要求为所有字段生成中文注释；已在候选 DDL 内补齐字段级 `COMMENT`，并同步补充表级注释                                                                                                                   |
| 2026-09-20 | 第二轮评审       | 用户确认：去掉 `CHECK` 取值约束、统一逻辑枚举（禁用 MySQL `ENUM` 与代码枚举类）、禁止写死取值。已删除 5 个 `CHECK` 约束，取值校验下沉到应用层，运行时常量唯一来源为 `packages/contracts`（见 Decision 7） |
| 2026-09-20 | 批准范围         | `chat_session` 6 列/2 索引、`chat_message` 8 列/3 索引、`chat_run` 10 列/3 索引；无外键、无 `ENUM`、无取值约束、字段 `snake_case` 且均有中文注释                                                          |
| 2026-09-20 | 门禁状态         | 用户 review 后指示继续实现，据此进入 Apply；评审时 `apps/api/drizzle/` 不存在业务迁移，且尚未在任何数据库执行过会话 DDL                                                                                   |

## Open Questions

无。DDL 结构与取值约束已经在评审中确认，实现阶段不再保留可自行决定的结构细节。
