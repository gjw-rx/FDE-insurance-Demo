# 车险续保助手

这是车险续保助手的项目级工程骨架。当前阶段只包含技术配置、DDD 目录、架构与测试设计、OpenSpec 需求资产，不包含业务 TypeScript 实现。

## 从这里开始

- [项目文档索引](./docs/README.md)
- [整体架构设计](./docs/architecture/system-design.md)
- [技术选型与包管理决策](./docs/decisions/0001-technology-stack.md)
- [Pi Agent 对接设计](./docs/integrations/pi-agent.md)
- [E2E 测试策略](./docs/testing/e2e-strategy.md)
- [AI 工程管理流程](./docs/engineering/ai-workflow.md)
- [当前 OpenSpec 变更](./openspec/changes/bootstrap-renewal-assistant/)
- [Archify 架构图源文件](./artifacts/architecture/system-architecture.architecture.json)

## 工程目录

```text
apps/
├── web/                    # React + Vite 前端骨架
└── api/                    # Fastify API 与基础设施适配器骨架
packages/
├── contracts/              # 前后端共享 DTO 与事件契约
├── domain/                 # 纯 TypeScript 领域模型
└── application/            # 用例与端口
tests/
└── e2e/                    # Playwright 用户旅程测试
docs/                       # 架构、决策、集成、测试与工程管理
openspec/                   # 需求、设计和迭代任务的事实来源
artifacts/architecture/     # Archify 图源与交付物
```

## 包管理

项目固定使用 Node.js 24 和 pnpm 12，版本入口见 `.nvmrc` 与根 `package.json` 的 `packageManager`/`engines`。首次安装执行：

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm workspace:list
```

新增内部依赖必须使用 `workspace:*`。不要在子目录生成独立锁文件，不要混用 npm、Yarn 或 Bun 安装依赖。

## 当前状态

- 已完成工程目录与依赖声明。
- 已完成目标产品规格、架构和测试方案。
- 业务实现需要按 OpenSpec backlog 拆成小变更逐项落地。
- Archify 图源已生成；当前尚有 1 个 showcase 几何诊断，未生成验收版 HTML，详情见架构文档。
