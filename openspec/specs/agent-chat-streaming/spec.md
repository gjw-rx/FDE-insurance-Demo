# agent-chat-streaming Specification

## Purpose

定义工作台文本消息经业务 API 创建 `insurance-agent` run，并通过 SSE 将回答增量流式呈现给用户的最小端到端行为，不引入会话持久化或其他保险业务逻辑。

## Requirements

### Requirement: 业务 API 创建 Agent run

系统 SHALL 提供 `POST /api/chat/runs` 接口，接收 `sessionId`、`runId` 和非空 `message`，通过内部 Agent 服务创建一次 run，并将接受结果返回给浏览器。浏览器 SHALL NOT 直接访问 `insurance-agent` 的内部端口。

#### Scenario: 成功创建 run

- **WHEN** 浏览器提交格式有效的 `sessionId`、`runId` 和非空消息，且 `insurance-agent` 接受该 run
- **THEN** API 返回 HTTP 202 及包含相同 `sessionId`、`runId` 和 `accepted` 状态的 run 快照，并且消息只被转发一次

#### Scenario: 创建请求无效

- **WHEN** 浏览器提交缺失标识、缺失消息或消息仅含空白的创建请求
- **THEN** API 返回 HTTP 400 的稳定错误响应，且不调用 `insurance-agent`

#### Scenario: Agent 服务拒绝创建

- **WHEN** `insurance-agent` 未就绪、达到容量上限或返回其他稳定服务错误
- **THEN** API 返回不含模型凭据、prompt 或内部堆栈的稳定错误响应，前端能够据此进入失败状态

### Requirement: 业务 API 代理 Agent SSE 事件

系统 SHALL 提供 `GET /api/chat/runs/:runId/events` SSE 接口，通过既有内部 typed client 订阅对应 run，并按 cursor 顺序向浏览器发送 `AgentRunEvent`。每个 SSE 事件 SHALL 使用事件 cursor 作为 `id`，并以 JSON `data` 承载稳定事件；API SHALL NOT 转发内部实现对象或新增敏感字段。

#### Scenario: 流式返回回答

- **WHEN** 浏览器订阅一个已接受 run，且 `insurance-agent` 产生回答增量和完成事件
- **THEN** API 以 `text/event-stream` 按 cursor 顺序发送 `answer.delta`，随后发送唯一的 `run.completed` 终态并关闭响应

#### Scenario: Agent run 失败

- **WHEN** 已订阅 run 产生 `run.failed` 或 `run.aborted` 终态
- **THEN** API 转发该唯一终态并关闭 SSE 响应，不把内部错误详情写入事件

#### Scenario: 订阅不存在的 run

- **WHEN** 浏览器请求订阅不存在或已过期的 `runId`
- **THEN** API 在建立 SSE 流前返回稳定错误响应，不返回伪造的回答事件

#### Scenario: 浏览器断开订阅

- **WHEN** 浏览器在 run 终态前关闭 SSE 连接或离开页面
- **THEN** API 取消对应的上游事件订阅并释放连接资源，但不主动停止该 Agent run

### Requirement: 前端发送并流式展示文本消息

系统 SHALL 在用户发送非空文本后立即清空输入框并在对话区追加该用户消息，通过业务 API 创建 run；创建成功后，系统 SHALL 订阅该 run 的 SSE，并把同一 run 的 `answer.delta.text` 按到达顺序拼接成一条助手消息。前端 SHALL 仅消费稳定事件类型，不根据回答文本推断报价、核保或其他业务状态。

#### Scenario: 发送消息并收到首个增量

- **WHEN** 用户输入非空文本并点击发送，API 接受 run 且返回首个 `answer.delta`
- **THEN** 输入框被清空，对话区显示原始用户文本，并出现包含首个增量内容的助手消息

#### Scenario: 连续增量组成一条回复

- **WHEN** 同一 run 依次返回多个 `answer.delta`
- **THEN** 对话区按事件顺序把所有增量追加到同一条助手消息，而不是为每个增量创建独立消息

#### Scenario: run 正常完成

- **WHEN** 当前 run 返回 `run.completed`
- **THEN** 对话区保留完整助手回复，发送入口恢复可用状态，且不追加终态事件的技术信息

### Requirement: 前端限制并发发送并反馈失败

系统 SHALL 在一个 run 活动期间阻止再次发送，避免同一页面产生并发消息；创建请求失败、SSE 连接失败或 run 以失败终态结束时，系统 SHALL 展示可感知的通用错误提示并恢复发送能力。已展示的用户消息和已收到的回答增量 SHALL 保留，错误提示 SHALL NOT 暴露内部错误详情。

#### Scenario: 活动 run 期间再次发送

- **WHEN** 当前消息对应的 run 尚未进入终态
- **THEN** 发送按钮保持不可用，用户无法触发第二个创建请求

#### Scenario: 创建请求失败

- **WHEN** 用户消息已显示，但 API 未能创建 run
- **THEN** 页面显示通用失败提示、恢复发送能力并保留该用户消息，不创建空的助手消息

#### Scenario: SSE 中断或失败终止

- **WHEN** SSE 在终态前异常结束，或收到 `run.failed`、`run.aborted`
- **THEN** 页面显示通用失败提示、恢复发送能力，并保留此前已展示的用户消息与回答增量

### Requirement: 页面内临时关联标识

系统 SHALL 在页面生命周期内使用一个临时 `sessionId` 关联本页发送，并为每次发送生成不同的 `runId`。这些标识 SHALL 只用于请求关联，不作为访问凭证或持久业务事实。

#### Scenario: 同一页面连续发送

- **WHEN** 用户在同一页面先后完成两次消息发送
- **THEN** 两次请求使用相同的 `sessionId` 和不同的 `runId`

#### Scenario: 刷新页面

- **WHEN** 用户刷新工作台页面
- **THEN** 页面建立新的临时 `sessionId`，且不尝试从 API 恢复刷新前的消息或 run
