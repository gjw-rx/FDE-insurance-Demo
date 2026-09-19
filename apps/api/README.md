# 业务 API

该应用是业务系统组合根，负责公开 HTTP/SSE 接口、请求校验、错误转换和基础设施适配器装配。当前已实现最小对话链路（见归档 change `openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/`）：把浏览器消息转发到独立 `insurance-agent` 并代理其 SSE 事件流。身份鉴权、会话持久化和续保/报价/核保业务仍属后续 change。

```text
src/
├── bootstrap/              # application factory 与进程入口
│   ├── application.ts      # 装配配置、Agent typed client 与公开路由
│   └── main.ts             # 进程启动与 SIGINT/SIGTERM 优雅关闭
├── config/                 # 非敏感运行配置与环境变量校验
├── interfaces/http/        # Fastify 路由、请求校验与错误转换
└── infrastructure/
    ├── agent/              # insurance-agent 内部 HTTP/SSE typed client
    ├── insurer/            # 各保险公司防腐层（后续）
    ├── knowledge/          # 保险知识库适配器（后续）
    └── persistence/        # 数据库、事件和对象存储适配器（后续）
```

## 公开接口

| Method | Path                           | 说明                                                          |
| ------ | ------------------------------ | ------------------------------------------------------------- |
| `GET`  | `/health/live`                 | 进程存活探针                                                  |
| `POST` | `/api/chat/runs`               | 校验 `{ sessionId, runId, message }` 后转发创建 run，返回 202 |
| `GET`  | `/api/chat/runs/:runId/events` | 代理 run 事件流：`id` 为 cursor，`data` 为稳定事件 JSON       |

错误响应只暴露 `@renewal/contracts` 的稳定错误码、脱敏文案与 `retryable`；连接、超时与协议错误统一映射为 `SERVICE_NOT_READY`，不透出内部地址或堆栈。首版不提供鉴权、会话持久化、SSE 断线续接与停止接口。

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

依赖规则：API 可以依赖 `application`、`domain` 和 `contracts`；这些内部包不得反向依赖 API 或 Fastify。`apps/api` 不直接依赖或初始化 Pi SDK，只通过 `src/infrastructure/agent/agent-service-client.ts` 使用 create/events/abort 传输接口；续保、报价、核保和材料等业务由后续 change 实现。
