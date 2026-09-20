## 前端开发强制规则

- 凡涉及 `apps/web/**` 或 `tests/e2e/**` 的分析、设计、编码、重构、测试与评审，开始工作前**必须先获取并遵守当前版本** [`.agents/rules/fronted-development.md`](.agents/rules/fronted-development.md)（规则名称：`fronted开发规范`）。若宿主已完整注入当前版本，不重复读取；新会话、文件变化或版本不确定时重新读取。
- 该规则是本项目的前端目录职责、依赖方向、React/TypeScript 实现和验证门禁基准；不得把业务组件、业务数据或通用 UI 继续堆放到 `apps/web/src/app/`。
- 若前端规则与本文其他要求存在冲突，以本文为准；OpenSpec、文档同步和 Git 规范不因引用前端规则而豁免。

## 后端开发强制规则

- 凡涉及 `apps/api/**`、`apps/insurance-agent/**`、`packages/application/**`、`packages/domain/**` 或 `packages/contracts/**` 的分析、设计、编码、重构、测试与评审，开始工作前必须读取并遵守当前版本 [`.agents/rules/backend-development.md`](.agents/rules/backend-development.md)（规则名称：`backend-development`）。
- 该规则约束 TypeScript/Node.js/Fastify 后端的目录职责、依赖方向、契约、可靠性、安全边界与验证方式；根目录要求、OpenSpec、文档同步和 Git 规范仍以本文及其引用文档为准。

## 1. 执行与澄清

- 下一步明确、可逆且在授权范围内时直接执行；缺少事实先读取证据。
- 只有影响范围、权限、外部行为或验收条件的歧义才询问；局部实现细节自行选择并记录必要假设。
- 普通编译错误、测试失败和已知工具兼容问题自行修复，不作为等待用户的理由。外部凭据/权限缺失或需要改变已确认范围时报告阻塞，继续独立工作。
- 多步骤任务先给简短计划与验收条件；不要为机械读取、格式化和状态更新展开长篇推演。

## 2. 修改边界

- 最小实现，不新增未要求的功能、依赖和预防性抽象；只改与当前任务直接相关的内容。
- 保留用户未提交改动，不顺手修复无关既有缺陷；清理本次修改产生的孤立代码。
- 代码修改前读取相关实现；完整内容已在上下文且文件未变化时不重读。编辑冲突或外部变化时按需刷新相关范围。

## 3. 验证与反馈

- 实现中运行相关检查，阶段结束执行全量门禁；同一输入版本的通过结果可覆盖多个任务，不为逐项勾选重复执行。
- 使用 `corepack pnpm verify:api`、`verify:web`、`verify:change`；Harness 自身使用 `verify:harness`。完整日志、退出码和摘要保存在 `.runtime/harness/`。
- 为获取错误详情读取已保存日志，不重跑测试；相同失败两轮无进展时补充新证据或改变策略。仅在有明确环境/诊断变化时使用 `--retry-reason`，不得编造理由绕过保护。
- 同一非阻断诊断不重复解释；分析工具不可用代表未知，不代表检查通过。真实错误和门禁失败仍须处理。
- 仅清理由本次任务启动的进程，禁止宽泛 `pkill -f`；测试显式使用 fake 服务地址，不能借用真实 Agent。

## 4. 推理与上下文

- 常规实现默认 medium；确定性读取/机械操作可用 low；跨服务语义、竞态或连续修复失败再用 high。Pi 可调用 `harness_effort` 显式切换，完成难点后恢复 medium；不按工具名称自动猜测难度。
- 用户显式指定的模型/思考等级优先；不要求或输出内部思考过程，只提供必要的结论、依据和验证结果。
- 阶段交接保留目标、约束、文件、当前失败、已排除假设和证据路径；长会话按需压缩，不丢失未解决问题的证据。
- 完整流程以 [AI 工程工作流](docs/engineering/ai-workflow.md) 为准，同一规则不在各层重复解释。

## 5. 项目 AI 协作与任务管理

- 本项目通过仓库文档和 OpenSpec 管理需求、设计、任务与完成证据；聊天记录和 Agent session 不能作为项目事实来源。
- 接手任务时，先阅读本文档、[项目文档地图](docs/README.md)和[AI 工程工作流](docs/engineering/ai-workflow.md)，再检查相关活动 change 的 `proposal.md`、delta specs、`design.md` 和 `tasks.md`。
- 给 Agent 安排工作时，明确一个可独立验收的目标、范围和验收条件。涉及产品行为或实现范围的工作，按 AI 工程工作流执行 Explore → Propose → Review → Apply → Verify → Archive；先评审 change 的范围、非目标、风险和验收场景，再按 `tasks.md` 逐项实现并记录验证证据。
- OpenSpec `tasks.md` 是迭代进度的唯一清单。只有真实完成且验证通过的任务才能勾选；实现和验证完成后，按工作流同步主 spec 并归档 change。
- 具体任务启动顺序、Ready/Done 标准、AI 操作边界和会话交接要求，以[AI 工程工作流](docs/engineering/ai-workflow.md)为准。

## 6. 文档目录与同步规范

| 目录                | 职责                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docs/arch/`        | 整体架构，包括前端、后端、模块边界、依赖方向和数据流；具体架构图源、渲染图和验证产物放在 `artifacts/`，由架构文档链接。 |
| `docs/engineering/` | AI 工作流、文档维护和 Agent 协作规范。                                                                                  |
| `docs/impl/`        | 第三方服务对接文档，例如 Pi SDK；记录接口、鉴权、数据映射、失败处理与联调方式。                                         |
| `docs/tech/`        | 中间件、框架、依赖、包管理工具和服务的技术资料，按技术或服务名称分别维护。                                              |
| `docs/product/`     | 产品愿景、边界和 roadmap，表达方向与顺序。                                                                              |
| `docs/testing/`     | 功能测试计划、场景覆盖和执行证据；每个 change 的计划使用 `<change-name>.md`。                                           |
| `docs/features/`    | 需求入口与迭代关联；`<feature-name>.md` 必须与 OpenSpec capability/spec 目录名一致。                                    |

- 功能迭代统一使用 OpenSpec。`docs/features/<feature-name>.md` 对应 `openspec/specs/<feature-name>/spec.md` 及活动 change 下的 `specs/<feature-name>/spec.md`；change 名描述本次变更，可关联多个需求。
- features 记录需求背景、范围和 spec/change 链接；可测试行为以 OpenSpec 为准，任务状态只维护在对应 change 的 `tasks.md`。
- 实现前准备当前 change 的测试计划；spec 实现完成后，必须同步 `docs/testing/<change-name>.md` 的场景覆盖、验证命令、实际结果和证据，完成后再归档。未执行不得写成通过。
- 引入或升级任何中间件、依赖、框架、工具或服务时，同步更新 `docs/tech/<technology-name>.md`，记录选型用途、实际版本、使用位置、配置与验证方式；对接第三方服务时，另在 `docs/impl/<service-name>.md` 维护对接细节并相互链接。
- 目录或文件改名时同步修复引用；架构改变时同步 `docs/arch/` 与关联的 `artifacts/` 图源和产物。详细字段、命名与交接规则见 [AI 工程工作流](docs/engineering/ai-workflow.md)。
- 新建文档时使用 [`.agents/templates/`](.agents/README.md) 中对应模板。提交前运行 `corepack pnpm docs:check`；仓库通过 `.agents/hooks/pre-commit` 对暂存区快照执行同一检查，失败时按提示补齐后再提交。

## 7. RTK命令执行规范

可以用RTK命令替代原生命令的时候，优先考虑RTK命令节省token

## 8. Git规范

Git 操作规范参考 `ciyuan-git` skill，涉及 Git 命令时遵循该 skill 的说明。

---
