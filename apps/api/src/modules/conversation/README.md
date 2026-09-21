# Conversation 模块

Conversation 是业务 API 内的对话限界上下文，负责会话、消息、run 和 Agent 事件订阅。

```text
conversation/
├── domain/                 # 会话标题、run 生命周期等领域规则
├── application/            # 用例、应用端口、读模型和 run 协调器
├── infrastructure/        # MySQL 仓储、内存替身、Agent HTTP/SSE 客户端
├── interfaces/http/        # HTTP/SSE 路由与协议映射
├── conversation_module.ts  # 模块内部依赖装配入口
└── README.md
```

## 查找入口

| 需求           | 入口                                                                |
| -------------- | ------------------------------------------------------------------- |
| 会话标题规则   | `domain/value_objects/session_title.ts`                             |
| 会话应用服务   | `application/session_service.ts`                                    |
| run 事件协调   | `application/run_coordinator.ts`                                    |
| 仓储端口       | `application/ports/conversation_repository.ts`                      |
| MySQL 仓储     | `infrastructure/persistence/mysql/mysql_conversation_repository.ts` |
| Agent 客户端   | `infrastructure/agent/agent_service_client.ts`                      |
| 会话 HTTP 路由 | `interfaces/http/session_routes.ts`                                 |
| run SSE 路由   | `interfaces/http/run_routes.ts`                                     |
| HTTP 统一注册  | `interfaces/http/conversation_routes.ts`                            |
| 模块装配       | `conversation_module.ts`                                            |

```

外部接口暂时继续使用 `/api/chat`，内部代码统一使用 `conversation` 语义，避免影响现有前端和 API 调用方。
```
