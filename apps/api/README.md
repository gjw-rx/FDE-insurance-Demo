# API 工程骨架

该应用是系统组合根，负责 HTTP/SSE 接口、身份鉴权、请求校验和基础设施适配器装配。当前只保留目录与依赖，不包含业务实现。

```text
src/
├── bootstrap/              # 进程启动、配置加载、依赖装配
├── interfaces/http/        # Fastify 路由、DTO 映射、错误转换
└── infrastructure/
    ├── agent/              # Pi SDK 适配器与保险业务工具注册
    ├── insurer/            # 各保险公司防腐层
    ├── knowledge/          # 保险知识库检索与回答生成适配器
    └── persistence/        # 数据库、事件和对象存储适配器
```

依赖规则：API 可以依赖 `application`、`domain` 和 `contracts`；这些内部包不得反向依赖 API 或 Fastify。
