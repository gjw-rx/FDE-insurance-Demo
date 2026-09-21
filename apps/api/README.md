# 业务 API

该应用是业务系统组合根，负责公开 HTTP/SSE 接口、请求校验、错误转换和基础设施适配器装配。当前已实现最小对话链路（见归档 change `openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/`）与聊天会话管理（见归档 change `openspec/changes/archive/2026-09-19-add-chat-session-management/`）：会话、消息与 run 记录由本服务保存，浏览器经业务 API 创建 run 并订阅 SSE，由 API 侧唯一 run 协调器消费上游事件。身份鉴权、跨重启持久化和续保/报价/核保业务仍属后续 change。

会话、消息与 run 记录的事实来源是 MySQL（见 change `persist-chat-sessions-with-mysql`）：生产路径使用 `MySqlChatSessionStore`，API 重启后历史仍可读取；启动时先执行一次幂等恢复，把上一个进程遗留的 `accepted`/`running` run 与 `streaming` 消息收敛为失败，且不重新启动 Agent。进程内实现 `InMemoryChatSessionStore` 只用于测试与本地替身，**生产路径没有内存回退**：注入数据库替身时必须显式注入会话仓储，否则组合根直接失败。

MySQL 连接、迁移与就绪检查由 `introduce-mysql-storage` 建立；本 change 在其上新增三张会话业务表（`chat_session`、`chat_message`、`chat_run`）。结构变更由发布流程显式执行迁移，不在进程启动时触发；表结构约束与 DDL 评审门禁见 [`.agents/rules/database-schema-design.md`](../../.agents/rules/database-schema-design.md)。

```text
src/
├── bootstrap/              # application factory 与进程入口
│   ├── application.ts      # 装配配置、数据库、会话仓储、会话服务、run 协调器与公开路由
│   ├── main.ts             # 进程启动与 SIGINT/SIGTERM 优雅关闭
│   └── migrate.ts          # 迁移命令入口（发布阶段显式执行）
├── application/chat/       # 会话应用服务、仓储端口、run 协调器与标题规则
├── config/                 # 运行配置与环境变量校验（含数据库连接）
├── interfaces/http/        # Fastify 路由、健康探针、请求校验与错误转换
└── infrastructure/
    ├── agent/              # insurance-agent 内部 HTTP/SSE typed client
    ├── database/           # MySQL 连接池、Drizzle 查询句柄、就绪检查与迁移执行
    ├── observability/      # JSON 行结构化日志实现
    ├── persistence/        # 会话仓储（MySQL 实现）、受控取值校验与进程内测试替身
    ├── insurer/            # 各保险公司防腐层（后续）
    └── knowledge/          # 保险知识库适配器（后续）
```

`drizzle/` 保存 schema 与迁移：`0000_baseline` 是不创建业务表的空基线，`0001_chat_session_tables` 创建会话三表。字段与表的中文注释只维护在迁移 SQL 内（当前 `drizzle-orm` 没有列注释 API），因此迁移生成后需人工补齐注释并经评审。

## 公开接口

| Method  | Path                                | 说明                                                                                |
| ------- | ----------------------------------- | ----------------------------------------------------------------------------------- |
| `GET`   | `/health/live`                      | 进程存活探针；不访问数据库，数据库故障不会触发进程重启                              |
| `GET`   | `/health/ready`                     | 数据库就绪探针；执行有界往返，未就绪返回 503 与脱敏原因                             |
| `POST`  | `/api/chat/sessions`                | 创建默认标题为「新会话」的空会话                                                    |
| `GET`   | `/api/chat/sessions?limit=&cursor=` | 邀请游标分页列出会话摘要（按最近更新时间倒序）                                      |
| `GET`   | `/api/chat/sessions/:sessionId`     | 返回会话摘要与有序持久消息                                                          |
| `PATCH` | `/api/chat/sessions/:sessionId`     | 重命名会话                                                                          |
| `POST`  | `/api/chat/runs`                    | 校验 `{ sessionId, runId, message }` 后保存消息并创建 run                           |
| `GET`   | `/api/chat/runs/:runId/events`      | 广播 run 事件流：`id` 为 cursor，`data` 为稳定事件 JSON；助手回答在终态一次性持久化 |

错误响应只暴露 `@renewal/contracts` 的稳定错误码、脱敏文案与 `retryable`；连接、超时与协议错误统一映射为 `SERVICE_NOT_READY`，不透出内部地址或堆栈。会话资源额外使用 `CHAT_SESSION_NOT_FOUND`（404）与 `CHAT_SESSION_STORE_UNAVAILABLE`（503 可重试）。结构化日志只记录事件名、sessionId/runId 与稳定错误码，不记录标题或消息正文。会话跨 API 重启持久化与启动恢复已实现；当前仍不提供鉴权、SSE 断线续接与停止接口，也不支持多写实例并发协作。

## 运行配置

非敏感配置通过环境变量提供，无密钥字段：

| 变量                          | 默认值                  | 说明                                                        |
| ----------------------------- | ----------------------- | ----------------------------------------------------------- |
| `API_HOST`                    | `127.0.0.1`             | 监听地址（默认仅 loopback）                                 |
| `API_PORT`                    | `4300`                  | 监听端口；`0` 表示随机端口                                  |
| `AGENT_BASE_URL`              | `http://127.0.0.1:4310` | insurance-agent 服务基地址                                  |
| `AGENT_CONNECT_TIMEOUT_MS`    | `3000`                  | 连接 Agent 服务超时                                         |
| `AGENT_RESPONSE_TIMEOUT_MS`   | `300000`                | 等待 Agent 响应/事件超时                                    |
| `DATABASE_URL`                | 无（必填）              | `mysql://用户:密码@主机:端口/库名`；缺失即拒绝启动          |
| `DATABASE_TLS_MODE`           | `verify-identity`       | 校验证书链与主机名；`disabled` 需显式豁免且生产环境一律拒绝 |
| `DATABASE_CA_FILE`            | 空                      | 自签证书的 CA 文件路径                                      |
| `DATABASE_ALLOW_INSECURE_TLS` | `false`                 | 仅非生产允许关闭 TLS，需显式设为 `true`                     |
| `DATABASE_POOL_SIZE`          | `10`                    | 连接上限，1–50                                              |
| `DATABASE_QUEUE_LIMIT`        | `20`                    | 池耗尽时的排队上限，1–500                                   |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000`                  | 建连超时，1–60000                                           |
| `DATABASE_QUERY_TIMEOUT_MS`   | `10000`                 | 查询超时，1–120000                                          |

配置只从环境注入，错误信息不含连接地址、用户名或密码；启动摘要只输出脱敏目标 `host:port/database`。详细约束见 [MySQL 技术资料](../../docs/tech/mysql.md)。

```bash
corepack pnpm --filter @renewal/api dev              # tsx watch
corepack pnpm --filter @renewal/api start            # 单次启动
corepack pnpm dev:api                                # 仓库根快捷方式
corepack pnpm --filter @renewal/api test             # 单元与应用级（不访问数据库）
corepack pnpm --filter @renewal/api test:integration # 真实数据库（需 DATABASE_TEST_URL）
corepack pnpm --filter @renewal/api db:generate      # 依 schema 生成迁移（生成后补齐注释并评审）
corepack pnpm --filter @renewal/api db:migrate       # 发布阶段显式迁移
```

本地开发从仓库根 `.env` 读取配置（`--env-file-if-exists`），云端由 secret provider 注入同名变量；`.env` 已被 `.gitignore` 忽略，不提交真实凭据。集成测试使用独立的 `DATABASE_TEST_URL`，不会回退到运行时 `DATABASE_URL`。

浏览器不直连 `insurance-agent`：开发环境由 Vite 将同源 `/api` 代理到本 API，生产环境由同源网关提供相同路径，因此当前不注册 CORS。

依赖规则：API 可以依赖 `application`、`domain` 和 `contracts`；这些内部包不得反向依赖 API 或 Fastify。`apps/api` 不直接依赖或初始化 Pi SDK，只通过 `src/infrastructure/agent/agent-service-client.ts` 使用 create/events/abort 传输接口；续保、报价、核保和材料等业务由后续 change 实现。会话仓储与会话服务通过接向接口协作，测试可注入替身。
