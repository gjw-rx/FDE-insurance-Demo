# 敏捷迭代路线

## Phase 0：工程骨架（当前）

- pnpm workspace 与版本约束。
- React/Fastify/Pi 依赖位置。
- DDD 目录与依赖方向。
- OpenSpec、架构、Pi 和 E2E 文档。

## Phase 1：纯领域闭环

- RenewalCase 聚合与五项资料值对象。
- 完整性、冲突、数据版本、报价有效性和幂等规则。
- BusinessSession 与统一 ID 映射。
- 不连接任何外部服务，以领域测试验收。

## Phase 2：API 与本地工作台

- Fastify 会话、字段和事件接口。
- React 对话、资料卡与进度卡。
- 内存或测试数据库适配器。
- P0 Playwright 场景跑通。

## Phase 3：外部能力

- 材料存储与 OCR。
- 保险知识库和快速问答。
- Pi Agent Runtime 与受控工具。
- 单家保险公司沙箱适配器。

## Phase 4：生产准备

- 权限、脱敏、审计和密钥管理。
- 数据库迁移、事件恢复和灾难恢复。
- 可观测性、容量、超时和告警。
- 多保险公司适配与灰度发布。

每个 Phase 拆成多个 OpenSpec change；只有前置能力验收通过后才开始依赖它的 change。
