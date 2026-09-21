# Application（已废弃占位）

当前应用层代码已按限界上下文迁移到 `apps/api/src/modules/<bounded_context>/application/`。

例如 Conversation 应用层位于：

```text
apps/api/src/modules/conversation/application/
```

该 workspace 包暂不承载生产代码，保留目录只是为了兼容现有 workspace 配置。新增用例和端口不要放回这里。
