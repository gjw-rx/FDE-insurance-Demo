# 业务 API

该应用是业务系统组合根，负责公开 HTTP/SSE 接口、请求校验、错误转换和基础设施适配器装配。当前已实现最小对话链路（见归档 change `openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/`）与聊天会话管理（见归档 change `openspec/changes/archive/2026-09-19-add-chat-session-management/`）：会话、消息与 run 记录由本服务保存，浏览器经业务 API 创建 run 并订阅 SSE，由 API 侧唯一 run 协调器消费上游事件。身份鉴权、跨重启持久化和续保/报价/核保业务仍属后续 change。

会话数据当前只保存在进程内（`InMemoryChatSessionStore`），API 重启后清空；仓储以 `ChatSessionStore` 接口注入，后续替换为文件或数据库实现时只改组合根。

```text
src/
├── bootstrap/              # application factory 与进程入口
│   ├── application.ts      # 装配配置、会话仓储、会话服务、run 协调器与公开路由
│   └── main.ts             # 进程启动与 SIGINT/SIGTERM 优雅关闭
├── application/chat/       # 会话应用服务、仓储端口、run 协调器与标题规则
├── config/                 # 非敏感运行配置与环境变量校验
├── interfaces/http/        # Fastify 路由、请求校验与错误转换
└── infrastructure/
    ├── agent/              # insurance-agent 内部 HTTP/SSE typed client
    ├── observability/      # JSON 行结构化日志实现
    ├── persistence/        # 会话仓储实现（当前为进程内）
    ├── insurer/            # 各保险公司防腐层（后续）
    └── knowledge/          # 保险知识库适配器（后续）
```

## 公开接口

| Method  | Path                                | 说明                                                      |
| ------- | ----------------------------------- | --------------------------------------------------------- |
| `GET`   | `/health/live`                      | 进程存活探针                                              |
| `POST`  | `/api/chat/sessions`                | 创建默认标题为「新会话」的空会话                          |
| `GET`   | `/api/chat/sessions?limit=&cursor=` | 邀请游标分页列出会话摘要（按最近更新时间倒序）            |
| `GET`   | `/api/chat/sessions/:sessionId`     | 返回会话摘要与有序持久消息                                |
| `PATCH` | `/api/chat/sessions/:sessionId`     | 重命名会话                                                |
| `POST`  | `/api/chat/runs`                    | 校验 `{ sessionId, runId, message }` 后保存消息并创建 run |
| `GET`   | `/api/chat/runs/:runId/events`      | 广播 run 事件流：`id` 为 cursor，`data` 为稳定事件 JSON   |

错误响应只暴露 `@renewal/contracts` 的稳定错误码、脱敏文案与 `retryable`；连接、超时与协议错误统一映射为 `SERVICE_NOT_READY`，不透出内部地址或堆栈。会话资源额外使用 `CHAT_SESSION_NOT_FOUND`（404）与 `CHAT_SESSION_STORE_UNAVAILABLE`（503 可重试）。结构化日志只记录事件名、sessionId/runId 与稳定错误码，不记录标题或消息正文。当前不提供鉴权、跨重启持久化、SSE 断线续接与停止接口。

## 运行配置

非敏感配置通过环境变量提供，无密钥字段：

| 变量                        | 默认值                  | 说明                        |
| --------------------------- | ----------------------- | --------------------------- |
| `API_HOST`                  | `127.0.0.1`             | 监听地址（默认仅 loopback） |
| `API_PORT`                  | `4300`                  | 监听端口；`0` 表示随机端口  |
| `AGENT_BASE_URL`            | `http://127.0.0.1:4310` | insurance-agent 服务基地址  |
| `AGENT_CONNECT_TIMEOUT_MS`  | `3000`                  | 连接 Agent 服务超时         |
| `AGENT_RESPONSE_TIMEOUT_MS` | `300000`                | 等待 Agent 响应/事件超时    |

```bash
corepack pnpm --filter @renewal/api dev     # tsx watch
corepack pnpm --filter @renewal/api start   # 单次启动
corepack pnpm dev:api                       # 仓库根快捷方式
corepack pnpm --filter @renewal/api test
```

浏览器不直连 `insurance-agent`：开发环境由 Vite 将同源 `/api` 代理到本 API，生产环境由同源网关提供相同路径，因此当前不注册 CORS。

依赖规则：API 可以依赖 `application`、`domain` 和 `contracts`；这些内部包不得反向依赖 API 或 Fastify。`apps/api` 不直接依赖或初始化 Pi SDK，只通过 `src/infrastructure/agent/agent-service-client.ts` 使用 create/events/abort 传输接口；续保、报价、核保和材料等业务由后续 change 实现。会话仓储与会话服务通过接向接口协作，测试可注入替身。
