# API 工程骨架

该应用是业务系统组合根，负责未来的公开 HTTP/SSE 接口、身份鉴权、请求校验和基础设施适配器装配。当前 change 只新增调用独立 `insurance-agent` 的内部 typed client，不包含业务实现或浏览器路由。

```text
src/
├── bootstrap/              # 进程启动、配置加载、依赖装配
├── interfaces/http/        # Fastify 路由、DTO 映射、错误转换
└── infrastructure/
    ├── agent/              # insurance-agent 内部 HTTP/SSE typed client
    ├── insurer/            # 各保险公司防腐层
    ├── knowledge/          # 保险知识库检索与回答生成适配器
    └── persistence/        # 数据库、事件和对象存储适配器
```

依赖规则：API 可以依赖 `application`、`domain` 和 `contracts`；这些内部包不得反向依赖 API 或 Fastify。

`apps/api` 不直接依赖或初始化 Pi SDK。`src/infrastructure/agent/agent-service-client.ts` 只提供 create/events/abort 统一传输接口及超时、错误映射；续保、报价、核保和材料等业务由后续 change 实现。
