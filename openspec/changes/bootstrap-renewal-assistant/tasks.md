## 1. 工程骨架

- [X] 1.1 建立 pnpm workspace、Node/TypeScript/ESM 统一配置和包管理约束，并以 `pnpm install` 和 workspace 清单验证
- [X] 1.2 建立 contracts、domain、application、api、web 的空目录、包清单和依赖方向说明，并检查仓库中没有业务 TypeScript 实现

## 2. 架构与项目材料

- [X] 2.1 使用 Archify 生成并交付整体对接架构 HTML，以 showcase 验证和桌面 visual-check 验收
- [X] 2.2 编写技术选型、DDD 架构、Pi 官方 SDK 对接、统一会话查询和 E2E 测试策略文档，并核对引用和仓库路径
- [X] 2.3 更新项目 README 与 AI 工程管理入口，使新成员能从 OpenSpec、架构图和决策记录找到权威资料，并验证链接有效

## 3. 后续敏捷迭代 Backlog

- [ ] 3.1 后续变更实现续保案件聚合与五项资料门禁，并用领域单元测试验证
- [ ] 3.2 后续变更实现业务会话映射、Pi Agent 端口和快速问答用例，并用应用测试验证
- [ ] 3.3 后续变更实现 Fastify API 与 React 工作台，并用 API 集成测试验证
- [ ] 3.4 后续变更实现 Playwright E2E，覆盖缺少发动机号时禁止提交及五项完整时进入核保
