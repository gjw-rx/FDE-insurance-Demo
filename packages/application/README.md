# Application

应用层组织用例和端口，不包含 Fastify 路由或具体 SDK 调用。

```text
src/
├── ports/                  # 仓储、Pi、知识检索、保险公司和 ID 生成端口
└── use-cases/              # 创建会话、更新资料、提交核保、快速问答
```

依赖方向：`application -> domain + contracts`。基础设施通过依赖注入实现端口。
