# 项目文档索引

## 权威顺序

发生冲突时，按以下顺序处理：

1. 已确认的 OpenSpec capability spec：产品可观察行为。
2. 当前变更的 `proposal.md` 与 `design.md`：本次范围和技术决策。
3. 本目录下的 ADR、架构和测试文档：长期工程约束。
4. 各 `apps/*`、`packages/*` 下的 README：局部目录职责。

不要从聊天记录或 Agent session 反推最终需求；重要决策必须写回 OpenSpec 或 ADR。

## 导航

| 主题                | 文档                                                             |
| ------------------- | ---------------------------------------------------------------- |
| 技术栈与 pnpm       | [0001-technology-stack.md](./decisions/0001-technology-stack.md) |
| DDD 与整体架构      | [system-design.md](./architecture/system-design.md)              |
| Pi SDK 与 sessionId | [pi-agent.md](./integrations/pi-agent.md)                        |
| E2E 测试            | [e2e-strategy.md](./testing/e2e-strategy.md)                     |
| AI 辅助开发流程     | [ai-workflow.md](./engineering/ai-workflow.md)                   |
| 迭代拆分            | [roadmap.md](./roadmap.md)                                       |

## 文档维护规则

- 修改用户可观察行为：先改 OpenSpec。
- 修改跨模块技术决策：新增或更新 ADR。
- 修改目录职责或依赖方向：同步更新架构文档和对应包 README。
- 外部 SDK 升级：记录版本、迁移影响、验证证据和回滚方式。
- 图和正文必须表达同一架构；Archify 源 JSON 与 HTML 放在同一目录。
