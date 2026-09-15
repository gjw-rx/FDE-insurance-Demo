## 前端开发强制规则

- 凡涉及 `apps/web/**` 或 `tests/e2e/**` 的分析、设计、编码、重构、测试与评审，开始工作前**必须先阅读并遵守** [`.agents/rules/fronted-development.md`](.agents/rules/fronted-development.md)（规则名称：`fronted开发规范`）。
- 该规则是本项目的前端目录职责、依赖方向、React/TypeScript 实现和验证门禁基准；不得把业务组件、业务数据或通用 UI 继续堆放到 `apps/web/src/app/`。
- 若前端规则与本文其他要求存在冲突，以本文为准；OpenSpec、文档同步和 Git 规范不因引用前端规则而豁免。

## 1.Think Before Coding

- [ ]

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

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
