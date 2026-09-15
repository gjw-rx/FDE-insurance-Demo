# Pi Agent 对接设计

技术选型、实际依赖版本与升级约束见 [Pi Coding Agent SDK](../tech/pi-sdk.md)。本文维护接口、权限、数据映射和联调边界。

## 官方能力结论

Pi 官方提供两种适合本项目的嵌入方式：

1. Node.js/TypeScript 进程内使用 `@earendil-works/pi-coding-agent` SDK。
2. 通过 `pi --mode rpc` 启动独立进程，使用 stdin/stdout JSONL 协议。

本项目选择 SDK 作为首选方案，因为 API 同样使用 TypeScript，可以直接订阅 Agent 事件、访问 session 状态和注册受控工具。RPC 保留为将来进程隔离或非 Node 宿主的替代方案。

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

浏览器不直接连接 Pi，也不持有模型密钥。推荐链路：

```text
React Web
  -> HTTPS: message/material/command
Fastify API
  -> Application use case
Pi SDK adapter
  -> AgentSession.prompt()
  <- session.subscribe(event)
Fastify API
  -> persist business event
  <- SSE cursor stream
React Web
```

Pi SDK 管理模型交互、消息上下文、loop、工具调用、压缩和流式事件。业务 API 管理鉴权、请求状态、业务 session、案件、幂等、超时和事件重放。

## 建议的业务接口

| API                                                   | 作用                       |
| ----------------------------------------------------- | -------------------------- |
| `POST /api/sessions`                                  | 创建业务会话与续保案件     |
| `GET /api/sessions/{sessionId}`                       | 恢复案件快照和最近运行摘要 |
| `POST /api/sessions/{sessionId}/messages`             | 提交一条消息并返回 runId   |
| `GET /api/sessions/{sessionId}/events?after={cursor}` | SSE 续接业务事件           |
| `POST /api/renewals/{renewalCaseId}/materials`        | 上传材料并创建识别任务     |
| `PATCH /api/renewals/{renewalCaseId}/fields`          | 保存/确认五项资料          |
| `POST /api/renewals/{renewalCaseId}/quotes`           | 发起报价                   |
| `POST /api/renewals/{renewalCaseId}/underwriting`     | 服务端门禁后提交核保       |

Pi 原始事件应转换为稳定的业务事件再发送给 Web。前端不解析 Agent 文本来判断 `canSubmit`、报价或核保状态。

## sessionId 设计

可以通过统一 ID 查询整条链路，但统一入口应是项目自己的 `sessionId`，不是 Pi 的内部 ID。

| ID                 | 归属       | 生命周期与用途                 |
| ------------------ | ---------- | ------------------------------ |
| `sessionId`        | 业务系统   | 用户一次连续交互；统一查询入口 |
| `renewalCaseId`    | Renewal    | 一笔续保业务，可跨多次运行     |
| `piSessionId`      | Pi         | Agent 上下文恢复和诊断         |
| `runId`            | 业务系统   | 一次消息或任务运行             |
| `traceId`          | 可观测系统 | 一次运行的跨服务调用链         |
| `insurerRequestId` | 保险适配层 | 对应外部报价/核保请求          |

数据库至少保存 `sessionId -> renewalCaseId` 以及每次 `runId -> piSessionId + traceId`。Pi SDK 的 `AgentSession.sessionId`、持久化 `SessionManager` 和从数据库 entries 恢复的能力可以支撑 Agent 上下文恢复；业务查询仍以项目数据库为准。

## Pi 工具边界

首期建议工具保持少而明确：

- `get_renewal_case(renewalCaseId)`
- `update_confirmed_fields(renewalCaseId, dataVersion)`
- `request_quotes(renewalCaseId)`
- `submit_underwriting(renewalCaseId, quoteId, idempotencyKey)`
- `get_underwriting_status(renewalCaseId)`

工具不接受模型拼接出的全量身份证或车辆资料。工具执行前，应用服务按当前登录用户重新加载案件并校验权限、五项完整性、数据版本、状态和幂等键。

## 快速问答配置

快速问答不复用续保 Agent 的工具循环。应用层先执行一次知识检索，再交给一次回答生成；运行不注册任何续保工具，禁用重试式自我反思，设置短超时和回答长度上限。Pi 的 thinking level 可以设为模型支持的最低值或关闭，但“一次检索、一次生成”的业务边界仍由应用代码控制。

## 可观测性

Pi telemetry 是进程内诊断契约，不是持久化业务状态，也不自带查询后台。项目需要把 `sessionId`、`runId`、`traceId` 和脱敏的工具结果写入选定的日志/trace 系统。禁止记录 prompt 全文、材料正文、身份证号、凭据和完整保险公司响应。
