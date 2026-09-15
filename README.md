# 车险续保助手

车险续保助手为用户提供材料整理、续保办理和保险知识问答。车主资料必须完整后才能进入核保流程；具体产品行为和验收要求以 OpenSpec 为准。

## 项目入口

- [文档地图与事实来源](./docs/README.md)
- [产品愿景](./docs/product/vision.md)
- [目标架构与 DDD 设计](./docs/arch/system-design.md)
- [Pi Agent 集成设计](./docs/impl/pi-agent.md)
- [E2E 测试策略](./docs/testing/e2e-strategy.md)
- [AI 工程工作流](./docs/engineering/ai-workflow.md)
- [OpenSpec 变更](./openspec/changes/)
- [Archify 架构图源文件](./artifacts/architecture/system-architecture.architecture.json)

## 本地环境

需要 Node.js 24 和 pnpm 12。版本约束与包管理规则见 [技术栈 ADR](./docs/tech/0001-technology-stack.md)。

```bash
corepack enable
corepack pnpm install --frozen-lockfile
```

## 项目状态

当前仓库提供 TypeScript monorepo 工程骨架、DDD 包边界和项目设计文档，不包含业务 TypeScript 实现。后续开发应按小范围 OpenSpec change 迭代。
