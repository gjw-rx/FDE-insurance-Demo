# 项目 Agent 资源

本目录保存 Agent 可以直接执行的项目辅助资源。项目约束入口仍是根目录 `AGENTS.md`，完整流程见 `docs/engineering/ai-workflow.md`。

## 项目规则

- [`rules/fronted-development.md`](./rules/fronted-development.md)：`fronted开发规范`，适用于 `apps/web/**` 与 `tests/e2e/**`，规定前端目录职责、依赖方向、实现约束和验证门禁。
- 前端工作必须先按根 [`AGENTS.md`](../AGENTS.md) 的强制入口读取该规则；根规则优先级高于目录内专项规则。

## 文档检查

- 手动运行：`corepack pnpm docs:check`。
- 检查脚本：`check-docs.mjs`。
- Git hook：`hooks/pre-commit`，基于暂存区快照执行检查。
- clone 仓库后启用：`git config core.hooksPath .agents/hooks`。

hook 失败时会阻止本次 commit，并列出失效链接、缺失的 feature、测试计划或 tech 文档等问题。修复并重新暂存文件后再次提交。

## 文档模板

- `templates/feature.md`：需求背景、边界和 OpenSpec 关联。
- `templates/testing.md`：change 测试计划、场景覆盖与执行证据。
- `templates/tech.md`：技术或依赖的版本、使用位置和维护方式。
- `templates/impl.md`：第三方服务的鉴权、接口、失败处理和联调方式。

复制模板后替换占位符和提示注释。模板只定义最低字段，可按实际复杂度增加内容。
