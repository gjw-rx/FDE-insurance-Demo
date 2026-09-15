# 项目级 AI 工程管理

## 目标

AI 可以加速分析、拆分、实现和验证，但需求、设计和完成证据必须落在仓库内。任何 Agent session 都可丢失，项目仍应能从 OpenSpec、ADR、代码和测试恢复上下文。

## 标准迭代流程

1. Explore：阅读现有 specs、代码与测试，明确歧义，不修改实现。
2. Propose：创建一个 kebab-case OpenSpec change，完成 proposal、delta specs、design、tasks。
3. Review：确认范围、外部行为、非目标、风险和验收场景。
4. Apply：严格按 tasks 逐项实现；每完成一项立即勾选并附验证证据。
5. Verify：运行该变更相关的最小充分测试，再执行合并门禁。
6. Archive：实现和验证全部完成后，归档 change 并同步主 specs。

## 变更切片

每个 change 只解决一个可独立验收的目标。建议后续按以下顺序拆分：

- `implement-renewal-domain`
- `implement-business-session`
- `integrate-material-extraction`
- `integrate-pi-renewal-agent`
- `implement-fast-insurance-qa`
- `integrate-first-insurer-sandbox`
- `build-renewal-workbench`
- `add-critical-e2e-flows`

不要在一个 change 中同时接真实 OCR、Pi、保险公司和完整前端，这会使故障归因与回滚困难。

## Definition of Ready

- 用户可观察结果和非目标明确。
- 外部系统、数据字段和权限边界明确。
- 每个 requirement 至少有一个可测试 scenario。
- 设计明确依赖方向、失败语义、幂等和恢复策略。
- tasks 每项都有验证方式，且能在一个工作会话内完成。

## Definition of Done

- 代码只覆盖 change 声明的范围。
- 领域规则有必要的单元测试；API 变更有集成测试。
- P0 行为有 E2E 或明确的后续任务，不能口头省略。
- 类型检查、格式、测试和构建全部通过。
- 文档、架构图和依赖版本与实现一致。
- 日志和测试产物不包含身份证号、材料正文或密钥。
- OpenSpec tasks 已按真实完成情况更新；未完成项不得勾选。

## AI 操作边界

- 修改前先读根 `AGENTS.md`、当前 change 和相邻模块 README。
- 只修改任务直接涉及的文件；发现无关问题只记录，不顺手重构。
- 不让模型决定能否投保、是否核保成功或是否重复提交。
- 不把 prompt 当业务规则；规则必须存在于领域/应用层并能自动测试。
- 外部写操作必须经过用户授权、业务权限和幂等校验。
- 依赖升级、数据迁移和 API breaking change 使用独立 change。

## 会话交接记录

每次开发会话结束时记录：

- 使用的 OpenSpec change 与完成比例。
- 修改的模块和关键决策。
- 已运行的验证命令与结果。
- 未解决问题、复现条件和下一步。
- 关联的 sessionId/runId/traceId（只记录非敏感 ID）。

交接信息优先写入 change 的 tasks/design 或 PR 描述，不另建无人维护的日志体系。
