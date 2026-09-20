# Pi Agent 对接设计

技术选型、实际依赖版本与升级约束见 [Pi Coding Agent SDK](../tech/pi-sdk.md)。本文维护接口、权限、数据映射和联调边界。

## 官方能力结论

Pi 官方提供两种适合本项目的嵌入方式：

1. Node.js/TypeScript 进程内使用 `@earendil-works/pi-coding-agent` SDK。
2. 通过 `pi --mode rpc` 启动独立进程，使用 stdin/stdout JSONL 协议。

本项目选择 SDK，并将它嵌入独立的 `apps/insurance-agent` 服务进程。业务 API 不直接依赖 Pi SDK，只通过 `apps/api/src/infrastructure/agent/agent-service-client.ts` 调用内部 HTTP/SSE 契约。当前 change 只建立运行时与统一接口，不实现任何保险业务。

官方入口：

- [Pi 官方仓库](https://github.com/earendil-works/pi)
- [Coding Agent SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [RPC Mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [Agent Core](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)
- [Telemetry](https://github.com/earendil-works/pi/blob/main/packages/telemetry/README.md)
- [Session 格式](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)
- [容器与权限隔离](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md)

旧 `badlogic/pi-mono` 地址已迁移，当前主分支包名为 `@earendil-works/*`。网络上的 `@mariozechner/*` 示例可能对应旧版本；开发时以锁定版本 `0.85.1` 的类型定义和官方文档为准。

## Web 与 Agent 对接

浏览器不直接连接 Pi，也不持有模型密钥。当前链路：

```text
React Web
  -> 业务 API：POST /api/chat/sessions，GET /api/chat/sessions，PATCH /api/chat/sessions/:sessionId
  -> 业务 API：POST /api/chat/runs，GET /api/chat/runs/:runId/events（SSE）
Fastify API
  -> internal HTTP: create / abort
  <- internal SSE: run events
insurance-agent
  -> Pi AgentSession.prompt()
  <- session.subscribe(event)
```

Pi SDK 管理模型交互、单次 run 上下文、loop、只读工具、压缩和原始事件。`insurance-agent` 管理并发、超时、终态和内存事件重放；业务 API 只持有 typed client，并额外持有会话仓储与 run 协调器：由 API 侧唯一的消费者持续读取上游 SSE，把 `answer.delta` 收敛为一条助手消息、在终态写入稳定状态，并向当前浏览器订阅者广播（见 change `add-chat-session-management` 的 design D6）。因此浏览器中途断开不会中断 Agent run。

当前会话与消息只保存在业务 API 进程内，重启后清空；鉴权与跨重启持久化由后续 change 实现。

## 当前内部服务契约

| Method | Path                                 | 结果                                                            |
| ------ | ------------------------------------ | --------------------------------------------------------------- |
| `GET`  | `/health/live`                       | 进程存活与 Agent 名称                                           |
| `GET`  | `/health/ready`                      | 配置、资源、catalog、模型与凭据 readiness                       |
| `POST` | `/internal/agent/runs`               | 接受 `{ sessionId, runId, message }`，重复 `runId` 返回既有快照 |
| `GET`  | `/internal/agent/runs/:runId/events` | 通过 `after` 或 `Last-Event-ID` 续接 SSE                        |
| `POST` | `/internal/agent/runs/:runId/abort`  | 幂等停止并返回当前快照                                          |

稳定错误码为 `INVALID_REQUEST`、`CONFIG_INVALID`、`MODEL_UNAVAILABLE`、`SERVICE_NOT_READY`、`CAPACITY_EXCEEDED`、`RUN_NOT_FOUND`、`EVENT_CURSOR_EXPIRED` 和 `INTERNAL_ERROR`。API client 将响应映射为 service、connection、timeout 或 protocol 错误，不新增浏览器路由。

## 配置、readiness 与生命周期

- 非敏感配置来自 `config/insurance-agent.json`；`INSURANCE_AGENT_CONFIG_PATH` 可指向环境专属配置。
- 模型密钥只从配置声明的环境变量（默认 `INSURANCE_AGENT_API_KEY`）注入内存，不写入配置、runtime data、日志或测试证据。
- `ModelRuntime` 显式使用 `.runtime/insurance-agent` 下的 `auth.json`、`models.json` 和 `models-store.json`；catalog 刷新有超时，模型或认证不可用时保持 not-ready，禁止 fallback。
- 每个 run 使用独立的内存 `SessionManager` 和 `AgentSessionRuntime`。重复 `runId` 不重复启动；容量超限返回可重试错误；完成、provider 失败、abort 与 timeout 只收敛到一个终态。
- SIGINT/SIGTERM 先停止接受新 run，再停止活动 run 并关闭 HTTP 服务。SSE 客户端断开只释放 subscriber，不中止 run。

## 事件与脱敏

对外只映射 run、agent、answer delta、turn、tool、retry、compaction 和终态事件，并为每个 run 分配单调 cursor。thinking、prompt、文件正文、工具参数/结果和 credential 不进入 SSE 或普通日志。事件按配置限制数量和保留时间，慢消费者断开后需携带 cursor 重连。

## 当前公开对话接口

| Method  | Path                                | 结果                                                      |
| ------- | ----------------------------------- | --------------------------------------------------------- |
| `GET`   | `/health/live`                      | 进程存活探针                                              |
| `POST`  | `/api/chat/sessions`                | 创建默认标题为「新会话」的空会话                          |
| `GET`   | `/api/chat/sessions?limit=&cursor=` | 按最近更新时间倒序返回会话摘要与下一页游标                |
| `GET`   | `/api/chat/sessions/:sessionId`     | 返回会话摘要与有序持久消息                                |
| `PATCH` | `/api/chat/sessions/:sessionId`     | 重命名会话，返回更新后的摘要                              |
| `POST`  | `/api/chat/runs`                    | 校验 `{ sessionId, runId, message }` 后创建 run，返回 202 |
| `GET`   | `/api/chat/runs/:runId/events`      | 广播 run 事件流；`id` 为 cursor，`data` 为稳定事件 JSON   |

错误响应复用 contracts 的稳定错误码与 `retryable`（会话资源新增 `CHAT_SESSION_NOT_FOUND` 与 `CHAT_SESSION_STORE_UNAVAILABLE`）；连接、超时与协议错误统一映射为 `SERVICE_NOT_READY`，不透出内部地址或堆栈。`sessionId` 由业务 API 在 `POST /api/chat/sessions` 时生成，浏览器不再自行生成；每次发送生成新的 `runId`。当前仍不提供鉴权、跨重启持久化、SSE 断线续接与停止接口。

## 后续业务接口（不在当前 change）

| API                                                   | 作用                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /api/sessions`                                  | 创建业务会话与续保案件（对话会话已由 `/api/chat/sessions` 实现，案件关联待后续 change） |
| `GET /api/sessions/{sessionId}`                       | 恢复案件快照和最近运行摘要                                                              |
| `POST /api/sessions/{sessionId}/messages`             | 提交一条消息并返回 runId                                                                |
| `GET /api/sessions/{sessionId}/events?after={cursor}` | SSE 续接业务事件                                                                        |
| `POST /api/renewals/{renewalCaseId}/materials`        | 上传材料并创建识别任务                                                                  |
| `PATCH /api/renewals/{renewalCaseId}/fields`          | 保存/确认五项资料                                                                       |
| `POST /api/renewals/{renewalCaseId}/quotes`           | 发起报价                                                                                |
| `POST /api/renewals/{renewalCaseId}/underwriting`     | 服务端门禁后提交核保                                                                    |

以上会话与续保接口尚未实现（除上方已列出的对话接口外）。后续 change 需要把 Agent 事件转换为稳定业务事件；前端不得解析 Agent 文本来判断 `canSubmit`、报价或核保状态。

## sessionId 设计

可以通过统一 ID 查询整条链路，但统一入口应是项目自己的 `sessionId`，不是 Pi 的内部 ID。

| ID                 | 归属       | 生命周期与用途                                                 |
| ------------------ | ---------- | -------------------------------------------------------------- |
| `sessionId`        | 业务系统   | 由业务 API 创建的会话；可列表、可重命名；本次仅存在 API 进程内 |
| `renewalCaseId`    | Renewal    | 一笔续保业务，可跨多次运行                                     |
| `piSessionId`      | Pi         | Agent 上下文恢复和诊断                                         |
| `runId`            | 业务系统   | 一次消息或任务运行；同一 `runId` 重复提交幂等                  |
| `traceId`          | 可观测系统 | 一次运行的跨服务调用链                                         |
| `insurerRequestId` | 保险适配层 | 对应外部报价/核保请求                                          |

业务会话、消息与 run 记录由 `apps/api` 的会话仓储保存（本次为进程内实现 `InMemoryChatSessionStore`，以接口注入，后续换数据库只替换实现）；仓储不保存 Pi 内部事件，业务查询仍以项目自己的数据为准。

## 后续业务工具边界（不在当前 change）

当前 runtime 的活动工具严格只有 Pi 内置 `read`、`grep`、`find`、`ls`，并通过执行前 hook 限制在受控工作目录内；没有注册下列业务 custom tools。未来如需增加，必须使用独立 OpenSpec change：

- `get_renewal_case(renewalCaseId)`
- `update_confirmed_fields(renewalCaseId, dataVersion)`
- `request_quotes(renewalCaseId)`
- `submit_underwriting(renewalCaseId, quoteId, idempotencyKey)`
- `get_underwriting_status(renewalCaseId)`

工具不接受模型拼接出的全量身份证或车辆资料。工具执行前，应用服务按当前登录用户重新加载案件并校验权限、五项完整性、数据版本、状态和幂等键。

## 后续快速问答配置

快速问答不在当前 change。未来实现时不复用续保 Agent 的工具循环，且“一次检索、一次生成”的业务边界仍由应用代码控制。

## 联调与验证

- 默认自动化使用 faux provider、临时 HOME/runtime data/working directory，不访问真实模型或开发机 Pi 配置。
- `corepack pnpm --filter @renewal/insurance-agent test` 验证配置、SDK runtime、只读路径门禁、run registry 和 HTTP/SSE。
- `corepack pnpm --filter @renewal/api test` 验证 create/events/abort、连接失败、超时和服务错误映射。
- 真实模型 smoke 仅在显式提供 `INSURANCE_AGENT_API_KEY` 后运行 `corepack pnpm --filter @renewal/insurance-agent smoke`，且只输出成功状态，不输出 prompt 或回答正文。

## 可观测性

Pi telemetry 是进程内诊断契约，不是持久化业务状态，也不自带查询后台。项目需要把 `sessionId`、`runId`、`traceId` 和脱敏的工具结果写入选定的日志/trace 系统。禁止记录 prompt 全文、材料正文、身份证号、凭据和完整保险公司响应。

当前实现由 `AgentRunLogger`（定义在 `run-registry.ts`，由 `bootstrap/application.ts` 注入实现）输出 JSON 行结构化运行日志：info 走 stdout、warn/error 走 stderr，便于部署侧分流采集，且启动摘要始终是 stdout 第一行。覆盖范围：

- run 生命周期：`run.accepted`、`run.duplicate`、`run.abort-requested`、终态 `run.completed`/`run.failed`（含稳定错误码）/`run.aborted`（含原因）、`service.stopping`。
- 拒绝路径：`run.rejected.capacity-exceeded`、`run.rejected.service-closed`、`http.run-create-rejected`（`invalid-request`/`service-not-ready`）、`http.run-abort-not-found`、`http.run-events-not-found`、`http.event-cursor-expired`。
- 失败摘要：`run.session-create-failed`、`run.prompt-failed` 记录 `Error.name: message` 摘要；对外 SSE 与响应仍只暴露 `INTERNAL_ERROR`，不回显原始错误。
- 资源与容量：`run.context-files-missing`（run 创建时配置的上下文文件已缺失）、`run.event-buffer-truncated`（事件缓冲被裁剪，只告警一次）、`sse.slow-consumer`。
- SSE 连接：`sse.subscribed`、`sse.closed`（区分 `terminal`/`client-disconnect`/`slow-consumer`）。
- readiness：`service.not-ready`、`service.readiness-warning`（启动摘要只带枚举码，具体原因靠日志回查）。

日志字段只包含 runId/sessionId/状态/错误摘要/缺失文件路径，不包含 prompt、回答正文、thinking、文件内容或凭据。
