## Why

车险续保助手需要同时支撑强约束的续保办理与低延迟保险问答。项目当前只有 OpenSpec 基础目录，需要先建立可执行的工程骨架、清晰的领域边界和可追踪的 Pi Agent 对接方式，避免把关键投保规则交给模型自由判断。

## What Changes

- 建立基于 pnpm workspace 的 React + TypeScript 前端与 TypeScript API 单仓库。
- 建立按 DDD 分层的续保案件、会话追踪和保险问答目录骨架与依赖边界。
- 将 VIN、发动机号、身份证号、车主姓名、车牌号定义为续保提交前的五项必填数据，并在应用服务层执行强校验。
- 定义 Pi Agent SDK 适配端口、业务工具边界、统一业务 sessionId 与 piSessionId/runId/traceId 的映射。
- 定义快速保险问答的单次检索、单次生成路径，使其不进入续保 Agent 多轮工具循环。
- 规划单元、API 集成和 Playwright E2E 测试过程，并沉淀架构、技术选型、官方资料和测试策略文档。
- 使用 Archify 生成可独立浏览的整体架构图。

## Capabilities

### New Capabilities

- `renewal-case-management`: 管理续保案件五项数据、完整性判断、提交门禁与状态。
- `agent-session-tracing`: 通过统一业务 sessionId 关联 Pi 会话、运行和续保案件，以支持恢复和故障查询。
- `insurance-knowledge-qa`: 基于已有保险知识库执行有界的快速问答，不进入续保办理工具循环。

### Modified Capabilities

无。

## Impact

- 新增 `apps/web`、`apps/api`、`packages/domain`、`packages/application`、`packages/contracts` 和测试目录。
- 引入 pnpm workspace、React、Vite、Fastify、TypeScript、Vitest、Playwright 及 Pi Coding Agent SDK。
- 后续 OCR、知识库、持久化和保险公司接口均通过端口与适配器接入；本次只提供工程目录、包依赖和设计文档，不实现业务代码。
