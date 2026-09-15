# Web 工程骨架

该应用采用 React + TypeScript + Vite，承载材料上传、五项资料确认、会话、报价和核保进度界面。当前只保留目录与依赖，不包含页面实现。

```text
src/
├── app/                    # 应用入口、路由、全局 provider
├── features/
│   ├── chat/               # 对话和快速保险问答
│   └── renewal/            # 材料、五项资料、报价与核保进度
└── shared/
    ├── api/                # HTTP/SSE 客户端
    └── ui/                 # 无业务语义的通用组件
```

Web 只依赖 `@renewal/contracts`，不直接依赖领域实体、Pi SDK 或保险公司 SDK。
