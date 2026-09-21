# Domain（已废弃占位）

当前业务领域代码已按限界上下文迁移到 `apps/api/src/modules/<bounded_context>/domain/`。

例如 Conversation 领域代码位于：

```text
apps/api/src/modules/conversation/domain/
```

该 workspace 包暂不承载生产代码，保留目录只是为了兼容现有 workspace 配置。新增领域代码不要放回这里。
