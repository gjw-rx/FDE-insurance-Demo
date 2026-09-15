# Domain

纯 TypeScript 领域层，不依赖 React、Fastify、Pi SDK、数据库或网络客户端。

```text
src/
├── renewal/                # RenewalCase 聚合、五项资料值对象、状态和领域错误
└── session/                # BusinessSession 聚合与 Agent 运行关联
```

续保五项固定为：VIN、发动机号、身份证号、车主姓名、车牌号。是否允许提交核保属于领域规则，不能放在提示词或前端判断中。
