## ADDED Requirements

### Requirement: 会话数据跨 API 重启持久保存

系统 SHALL 将会话摘要、用户消息、助手消息和 run 状态保存到业务 API 可恢复的 MySQL 存储中。API 正常重启后，已确认成功写入的数据 SHALL 可通过既有会话列表与详情接口读取；生产路径不得静默回退到进程内临时存储。

#### Scenario: API 重启后恢复会话

- **WHEN** 会话、消息和已完成 run 已成功保存且业务 API 正常重启
- **THEN** 历史列表返回该会话，详情返回原会话摘要及按原顺序排列的消息和终态

#### Scenario: 存储不可用时拒绝写入

- **WHEN** MySQL 不可写或连接不可用且用户尝试创建、重命名会话或追加消息
- **THEN** 系统返回稳定的 `CHAT_SESSION_STORE_UNAVAILABLE` 错误，不报告操作成功，不写入内存后备，也不在日志中输出消息正文或连接凭据

#### Scenario: 读取不存在的持久化会话

- **WHEN** 用户请求数据库中不存在的 `sessionId`
- **THEN** 系统继续返回既有稳定的 `CHAT_SESSION_NOT_FOUND` 语义，且不跨会话读取消息

### Requirement: 会话写入必须保持消息与 run 的幂等一致性

系统 SHALL 在持久化用户消息、run 记录、自动标题和会话更新时间时保持一致的业务写入边界。相同 `runId` 的重复请求 SHALL 返回已有记录且不得重复创建消息、标题变更或 Agent 执行；不同会话复用同一 `runId` SHALL 被拒绝。

#### Scenario: 重复 run 请求不重复落库

- **WHEN** 同一 `sessionId` 以相同 `runId` 重复提交相同用户消息
- **THEN** 系统返回同一既有 run/消息结果，会话中仅保留一条对应用户消息，且 Agent 不被重复启动

#### Scenario: 跨会话复用 runId

- **WHEN** 一个已存在于会话 A 的 `runId` 被会话 B 提交
- **THEN** 系统拒绝该请求，不新增会话 B 的消息或 run 记录

#### Scenario: 首条消息与自动标题一致提交

- **WHEN** 默认标题会话首次成功接受非空用户消息且数据库写入成功
- **THEN** 用户消息、run、规范化标题和会话更新时间共同成功保存；任一持久化失败时不得只更新其中一部分

### Requirement: 重启恢复必须收敛遗留活动状态

系统 SHALL 在启动恢复阶段识别数据库中遗留的 `accepted`、`running` 或消息 `streaming` 状态，并将无法续接的活动 run 收敛为稳定失败/中断语义。恢复过程 SHALL 幂等执行，且不得重新启动已存在的 Agent run。

#### Scenario: 遗留 streaming run 被收敛

- **WHEN** API 启动时数据库存在上一次进程留下的非终态 run 和 streaming 助手消息
- **THEN** 系统将其收敛为可读取的失败/中断结果，详情不再永久显示 streaming，且不重新调用 Agent

#### Scenario: 重启恢复重复执行

- **WHEN** 已完成一次启动恢复后再次执行恢复检查
- **THEN** 系统不重复追加消息、不改变已收敛终态，并保持会话更新时间和消息顺序有效
