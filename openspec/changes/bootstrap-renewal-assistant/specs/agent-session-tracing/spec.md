## Purpose

定义面向用户与运营排障的统一会话查询能力，使一次续保交互可以关联业务案件、Pi 会话、单次运行和跨服务调用记录。

## ADDED Requirements

### Requirement: 业务会话作为统一查询入口

系统 SHALL 生成自身管理的业务 sessionId，并将 renewalCaseId、piSessionId、runId 和 traceId 作为关联标识保存；外部查询不得依赖 Pi 内部文件路径。

#### Scenario: 创建业务会话

- **WHEN** 用户进入续保助手并创建会话
- **THEN** 系统返回业务 sessionId，并建立该会话与续保案件的关联

#### Scenario: 关联一次 Agent 运行

- **WHEN** 后端启动一次 Pi Agent 运行
- **THEN** 系统记录业务 sessionId、Pi sessionId、runId 和 traceId 的映射

### Requirement: 会话查询返回可恢复的业务状态

系统 SHALL 允许授权用户使用业务 sessionId 查询当前续保状态、缺失字段和最近运行摘要；Pi 历史仅作为诊断信息，不能覆盖业务数据库状态。

#### Scenario: 页面刷新后恢复

- **WHEN** 已授权用户使用已有业务 sessionId 重新加载页面
- **THEN** 系统返回续保案件的当前状态和已收集字段，不要求重新开始会话

#### Scenario: 未授权查询

- **WHEN** 调用方无权访问指定业务 sessionId
- **THEN** 系统拒绝返回案件资料与 Agent 诊断信息

### Requirement: 事件流支持断线续接

系统 SHALL 为业务事件分配单调递增的事件游标，使客户端重连后可以请求遗漏事件并再读取最终业务状态。

#### Scenario: SSE 连接中断后重连

- **WHEN** 客户端携带最后收到的事件游标重新订阅
- **THEN** 系统从下一条事件开始发送并允许客户端重新获取当前业务状态
