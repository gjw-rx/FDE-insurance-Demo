# 端到端对话流式链路

> Feature：`agent-chat-streaming`

## 背景与用户目标

工作台首屏静态壳与独立 `insurance-agent` 服务均已就绪，但用户消息仍停留在浏览器本地：`apps/api` 只有调用 Agent 服务的内部 typed client，没有可启动的进程和面向浏览器的接口；前端发送按钮只清空输入，不追加消息也不发请求。

用户目标是最小打通 `Web → API → insurance-agent → API SSE → Web`：在对话框发送文本后，消息经业务 API 创建 Agent run，回答以 SSE 增量流式呈现在对话区。

## 范围

- 业务 API 提供两个公开接口：`POST /api/chat/runs`（创建 run）与 `GET /api/chat/runs/:runId/events`（SSE 订阅 run 事件），复用现有 `AgentServiceClient` 转发到 `insurance-agent` 内部接口。
- 前端发送非空文本后立即追加用户消息，订阅 SSE 并把同一 run 的 `answer.delta` 按顺序拼接为一条助手消息，终态后恢复发送。
- 页面生命周期内使用一个临时 `sessionId`，每次发送生成新的 `runId`；刷新页面后不恢复旧消息。
- 活动 run 期间禁用发送按钮，避免并发消息；创建失败、流中断和失败终态展示通用错误提示。
- 文件选择保持既有本地类型校验，不上传任何文件。

## 非目标

- 不做登录鉴权、会话/消息/run 持久化、刷新恢复或 SSE cursor 重连。
- 不做停止/取消按钮、自动重试、Markdown 渲染、文件上传或材料识别。
- 不做并发消息队列或多标签页协调。
- 不让浏览器直连 `insurance-agent` 内部端口，也不把模型回复当作报价、核保等业务状态事实来源。
- 不改变 `insurance-agent` 内部契约与运行时行为。

## OpenSpec 关联

- 主 spec：[agent-chat-streaming](../../openspec/specs/agent-chat-streaming/spec.md)
- 归档 change：[2026-09-19-connect-chat-agent-streaming](../../openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/)
- 归档 Delta spec：[agent-chat-streaming](../../openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/specs/agent-chat-streaming/spec.md)、[workbench-shell](../../openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/specs/workbench-shell/spec.md)
- 测试计划：[connect-chat-agent-streaming 测试计划](../testing/connect-chat-agent-streaming.md)

## 维护说明

可测试行为以 OpenSpec 为准，任务状态以 change 的 `tasks.md` 为准。本页只维护需求背景、边界和关联入口。
