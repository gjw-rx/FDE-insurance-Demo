## Why

当前聊天页只在页面生命周期内生成临时 `sessionId`，刷新后消息丢失，也无法主动开始一段独立对话或返回历史对话。需要把会话提升为可持久化、可切换和可命名的业务资源，让用户能够管理多段 Agent 对话。

## What Changes

- 新增由业务 API 保存的聊天 session：可创建会话、分页查看历史会话、读取指定会话及其历史消息、重命名会话。本次实现为**进程内存储**，跨重启持久化按已确认的延期决定留给后续独立 change（详见 design.md「已确认的延期范围」）。
- 新建会话默认标题为“新会话”；首次成功提交用户消息后，服务端依据该消息生成截断后的标题，用户后续仍可手动重命名。
- 调整聊天发送链路：run 必须关联已存在的 session，并将用户消息、Agent 回答和稳定终态持久化；重新进入历史会话时恢复已保存消息。
- 在工作台聊天区域增加新建会话入口和历史会话列表，支持选择会话与重命名，并呈现加载、空列表、失败和重试状态。
- 当前系统未引入登录鉴权，因此会话历史暂按单个部署实例全局共享；界面明确不宣称用户级隔离。
- 不包含删除/归档会话、全文搜索、跨实例同步、用户鉴权、并发编辑协作、自动摘要模型调用或恢复进行中的 SSE。
- 调整 `workbench-shell`「无后端服务的静态展示」：API 不可用时允许会话区域展示自身的加载失败与重试状态，其余四个区域和本地交互保持不变。原因是本次首屏新增历史会话请求，该请求在无后端时必然失败，与原文「页面初始状态不显示请求错误」互斥。

## Capabilities

### New Capabilities

- `chat-session-management`: 定义聊天会话的创建、历史列表、详情恢复、自动命名和手动重命名行为；对应新增 `docs/features/chat-session-management.md`。

### Modified Capabilities

- `agent-chat-streaming`: 将页面内临时会话改为业务 API 已创建的会话，并要求消息在会话生命周期内可供后续历史恢复；同步更新 `docs/features/agent-chat-streaming.md`。
- `workbench-shell`: 调整「无后端服务的静态展示」，允许首屏会话区域在 API 不可用时展示加载失败与重试，同时保持四个区域完整展示与本地交互可用；同步更新 `docs/features/workbench-shell.md`。

## Impact

- 契约：`packages/contracts` 新增会话摘要、会话详情、持久消息及创建/列表/重命名请求响应类型。
- API：`apps/api` 新增 session 资源接口及持久化仓储，并调整 `POST /api/chat/runs` 对 session 的校验和消息落库流程。
- Web：`apps/web/src/features/chat/` 新增会话导航和重命名交互，`shared/api/` 增加会话客户端；应用顶层仅负责组合布局。
- Agent：继续复用现有 `insurance-agent` run/SSE 契约，不新增 Pi SDK 能力；不把 Pi 内部 session 作为业务查询入口。
- 数据与部署：本次会话数据保存在业务 API 进程内，重启后清空；仓储通过接口注入，后续换 DB 只替换实现。不得在日志或列表摘要中保存或展示敏感材料正文。
- 验收影响：本 change 按已实现范围归档（2026-09-19 用户确认）。delta spec 中「会话跨服务重启持久保存」未实现，已从本 change 范围移除并移交后续持久化 change；该 requirement 由后续 change 向 `chat-session-management` 主 spec ADD，需求原文记录在 `docs/features/chat-session-management.md`「后续范围」。
- 测试与文档：新增 API 集成测试、前端行为测试和关键 E2E；准备 `docs/testing/add-chat-session-management.md`，并同步需求入口、API/架构及采用的持久化技术文档（如引入新依赖）。
