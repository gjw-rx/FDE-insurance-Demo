## Why

当前工作台对话输入区只在浏览器本地清空文本，`apps/api` 也只有调用 `insurance-agent` 的内部 typed client，用户消息尚不能到达 Agent，更无法看到流式回复。本 change 以最小范围打通 `Web → API → insurance-agent → API SSE → Web` 请求链路，为后续会话持久化和业务能力接入提供可验证的基础。

## What Changes

- 在 `apps/api` 增加可启动的最小 Fastify 组合根，并提供创建 Agent run 与订阅 run 事件的公开 HTTP/SSE 接口；API 复用现有 typed client 调用 `insurance-agent`，不在自身进程初始化 Pi SDK。
- 在前端对话区发送非空文本时追加用户消息，通过 API 创建 run，并把 SSE 中的 `answer.delta` 持续拼接到当前助手消息，直到 run 进入终态。
- 为页面会话和单次发送生成临时 `sessionId`、`runId`；标识仅在当前页面生命周期内使用，不建立数据库或恢复语义。
- 增加最小加载、发送中与失败反馈，防止同一输入被重复发送；保留现有文件类型本地校验，但不实现文件上传。
- 修改工作台“输入区仅本地交互、无后端运行”的既有约束，使文本发送走 API；报价卡片、保司选择和文件选择仍保持原有本地行为。
- 新增/更新需求入口、测试计划、API/Web README、Pi Agent 对接与架构说明；不新增 npm 依赖。

## Capabilities

### New Capabilities

- `agent-chat-streaming`: 定义用户从工作台发送文本消息、业务 API 转发 Agent run、SSE 流式返回回答以及前端可观察状态的最小端到端行为；对应需求入口为 `docs/features/agent-chat-streaming.md`。

### Modified Capabilities

- `workbench-shell`: 将对话文本发送从“仅本地清空且不追加消息、不发请求”改为追加消息并调用 API；同时把无后端可用边界收窄为非对话的静态展示与本地交互。对应需求入口为 `docs/features/workbench-shell.md`。

## Impact

- 受影响代码：`apps/web/src/features/chat/`、`apps/web/src/shared/api/`、`apps/api/src/bootstrap/`、`apps/api/src/interfaces/http/`、现有 `apps/api/src/infrastructure/agent/`，以及相关自动化测试。
- 公开接口：新增创建 run 的 JSON 接口和按 `runId` 订阅的 SSE 接口；内部 `insurance-agent` 契约和 `@renewal/contracts` 事件类型保持不变。
- 运行影响：本地联调需同时启动 Web、API 与 `insurance-agent`；API 的 Agent 服务地址通过非敏感配置提供，浏览器不直接访问内部 Agent 端口。
- 文档影响：新增 `docs/features/agent-chat-streaming.md`、`docs/testing/connect-chat-agent-streaming.md`，更新 `docs/features/workbench-shell.md`、`docs/arch/system-design.md`、`docs/impl/pi-agent.md`、`apps/api/README.md` 和 `apps/web/README.md`。
- 非目标：登录鉴权、会话/消息持久化、断线续接、跨 run 上下文恢复、停止按钮、文件上传、材料识别、报价、核保、模型文本业务解析及生产级网关策略。
