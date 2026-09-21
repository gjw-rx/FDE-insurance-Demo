-- 会话业务表（change: persist-chat-sessions-with-mysql）
--
-- 本迁移由 `drizzle-kit generate` 依据 `drizzle/chat-schema.ts` 生成，随后按已 review
-- 的候选 DDL（见该 change 的 design.md「候选 DDL」与「DDL Review 记录」）人工补齐
-- drizzle-kit 无法表达的部分：
--
-- 1. 每列的中文 COMMENT 与表级 COMMENT（`drizzle-orm@0.45.2` 无列注释 API）；
-- 2. 显式 ENGINE / CHARSET / COLLATE，避免依赖服务器默认值；
-- 3. 主键与索引改为与批准版 DDL 一致的内联声明形式（语义等价：InnoDB 的主键索引
--    名恒为 PRIMARY，且本项目禁止外键，约束名没有引用方）。
--
-- `meta/0001_snapshot.json` 仍由 drizzle-kit 维护，后续迁移以该快照为差异基线。
--
-- 结构约束：无外键、无 ENUM 类型、无取值校验约束；受控取值（标题来源、角色、消息
-- 状态、run 状态、中断原因）使用逻辑枚举，取值合法性由应用层按 `@renewal/contracts`
-- 在写库前校验。字段与表注释不得包含凭据或消息正文。

CREATE TABLE `chat_session` (
	`session_id` char(36) NOT NULL COMMENT '会话标识；由应用层生成的 UUID，仅作关联数据，不是访问凭证',
	`title` varchar(60) NOT NULL COMMENT '会话标题；默认「新会话」，按 Unicode 码点截断至 60，不写入日志',
	`title_source` varchar(20) NOT NULL COMMENT '标题来源：default 默认标题、first-message 首条消息自动命名、manual 用户手动；manual 后不再被新消息覆盖；库内不加取值约束，取值合法性由应用层校验',
	`created_at` datetime(3) NOT NULL COMMENT '创建时间；由应用层写入 UTC，不依赖数据库时钟',
	`updated_at` datetime(3) NOT NULL COMMENT '最近更新时间；会话内消息变更时刷新，列表按它倒序分页',
	`next_message_order` bigint unsigned NOT NULL DEFAULT 1 COMMENT '下一条消息的会话内序号；事务内锁定本行分配，保证同会话消息顺序',
	PRIMARY KEY (`session_id`),
	KEY `idx_chat_session_updated` (`updated_at`,`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='聊天会话摘要；标题与更新时间用于历史列表分页';
--> statement-breakpoint
CREATE TABLE `chat_message` (
	`message_id` char(36) NOT NULL COMMENT '消息标识；由应用层生成的 UUID',
	`session_id` char(36) NOT NULL COMMENT '所属会话标识；无外键，关联完整性由仓储事务保证',
	`run_id` char(36) NOT NULL COMMENT '所属 run 标识；与 role 组成唯一键，保证一个 run 最多一条用户消息和一条助手消息',
	`message_order` bigint unsigned NOT NULL COMMENT '会话内顺序号，从 1 开始；详情按它排序，不按时间戳或 ID 推断',
	`role` varchar(16) NOT NULL COMMENT '消息角色：user 用户、assistant 助手；库内不加取值约束，取值合法性由应用层校验',
	`status` varchar(20) NOT NULL COMMENT '消息状态：accepted 已接收、send-failed 发送失败、streaming 生成中、completed 完成、failed 失败；库内不加取值约束，取值合法性由应用层校验',
	`text` longtext NOT NULL COMMENT '消息正文；属敏感内容，禁止写入日志、SSE 错误和测试证据',
	`created_at` datetime(3) NOT NULL COMMENT '创建时间；由应用层写入 UTC',
	PRIMARY KEY (`message_id`),
	UNIQUE KEY `uq_chat_message_run_role` (`run_id`,`role`),
	KEY `idx_chat_message_session_order` (`session_id`,`message_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='会话消息；顺序由 message_order 决定，正文不外泄';
--> statement-breakpoint
CREATE TABLE `chat_run` (
	`run_id` char(36) NOT NULL COMMENT 'run 标识；由应用层生成，重复提交以此幂等，不重复启动 Agent',
	`session_id` char(36) NOT NULL COMMENT '所属会话标识；无外键，关联完整性由仓储事务保证',
	`agent_name` varchar(100) NOT NULL COMMENT 'Agent 名称；取自 Agent 快照，仅用于诊断，不作为业务规则',
	`status` varchar(20) NOT NULL COMMENT 'run 状态：accepted/running 为非终态，completed/failed/aborted 为唯一终态；库内不加取值约束，取值合法性由应用层校验',
	`snapshot_json` json COMMENT 'Agent 快照 JSON；仅在 Agent 接受后写入，不参与查询过滤',
	`created_at` datetime(3) NOT NULL COMMENT '创建时间；由应用层写入 UTC',
	`updated_at` datetime(3) NOT NULL COMMENT '最近更新时间；重启恢复按它与 status 定位遗留非终态 run',
	`finished_at` datetime(3) COMMENT '进入终态的时间；非终态为 NULL',
	`abort_reason` varchar(20) COMMENT '中断原因：requested 调用方请求、timeout 服务超时；仅 aborted 时写入；库内不加取值约束，取值合法性由应用层校验',
	`error_code` varchar(80) COMMENT '稳定错误码；仅 failed 时写入，不保存原始错误正文',
	PRIMARY KEY (`run_id`),
	KEY `idx_chat_run_session_status` (`session_id`,`status`),
	KEY `idx_chat_run_status_updated` (`status`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Agent run 的幂等与终态记录；重启恢复据此收敛遗留状态';
