# 项目级 AI 工程管理

## 目标

AI 可以加速分析、拆分、实现和验证，但需求、设计和完成证据必须落在仓库内。任何 Agent session 都可丢失，项目仍应能从 OpenSpec、ADR、代码和测试恢复上下文。

文档归属和冲突处理见[项目文档地图](../README.md)。不要将本流程、产品路线图和 OpenSpec tasks 当作三份并行 backlog：OpenSpec tasks 是迭代状态的唯一清单。

## 文档目录规范

| 目录                | 维护内容                                                                         | 何时同步                                       |
| ------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `docs/arch/`        | 整体项目架构，涵盖前后端、模块边界、依赖方向、运行路径和数据流。                 | 模块、接口边界或数据流变化时。                 |
| `artifacts/`        | 具体架构图的图源、渲染产物与验证证据；当前架构图位于 `artifacts/architecture/`。 | 对应架构变化时，与 `docs/arch/` 一起更新。     |
| `docs/engineering/` | AI 工作流、Agent 协作和文档维护规范。                                            | 开发、验证或交接方式变化时。                   |
| `docs/impl/`        | 第三方服务对接说明，例如 Pi SDK、OCR、保险公司接口。                             | 新增服务对接或调整对接契约时。                 |
| `docs/tech/`        | 中间件、框架、依赖、包管理工具及服务的技术资料，按名称区分。                     | 引入、升级、替换或移除相关技术时。             |
| `docs/product/`     | 产品愿景、边界与 roadmap。                                                       | 产品方向、阶段目标或建设顺序变化时。           |
| `docs/testing/`     | 总体测试策略，以及各 change 的功能测试计划与执行证据。                           | 提出变更时准备计划；实现完成后同步覆盖与结果。 |
| `docs/features/`    | 需求背景、范围和相关 spec/change 的入口。                                        | 新增需求或调整需求范围时。                     |

架构图应标明描述的是目标设计还是已实现状态，不能仅凭图的存在宣称功能已完成。`product` 不维护逐项任务状态；`features` 不复制 OpenSpec 的 requirement、scenario 或 tasks。

新建 feature、testing、tech 或 impl 文档时，分别复制 `.agents/templates/feature.md`、`testing.md`、`tech.md` 或 `impl.md`。模板定义最低信息要求，可以删除不适用的提示注释，但不得省略规范要求的实际内容。

### 需求、spec 与 change 命名

- 需求标识使用稳定的 kebab-case 名称：`docs/features/<feature-name>.md`。
- OpenSpec 的 capability/spec 使用同一个名称：主 spec 为 `openspec/specs/<feature-name>/spec.md`，变更 spec 为 `openspec/changes/<change-name>/specs/<feature-name>/spec.md`。
- change 名描述本次可独立验收的变更，不强制与需求名相同。一个 change 可修改多个需求，一个需求也可经历多个 change；在需求文档与 change 的 proposal 中相互链接。
- 每份需求文档至少记录需求标识、背景、范围与非目标、相关 spec 和 change 路径。主 spec 尚未生成时明确标注，以活动 change 的 delta spec 为入口；不要创建空 spec 来凑齐链接。
- 例如 `docs/features/renewal-case-management.md` 对应 `specs/renewal-case-management/spec.md`，本次实现可由 `implement-renewal-domain` change 管理。
- 需求更名必须同时更新 features 文件名、主 spec 与活动 delta spec 的目录名及引用；已归档 change 保留历史名称，在需求文档中记录名称映射。

### 技术资料与第三方对接

引入任何中间件、依赖、框架、包管理工具或服务，必须同步维护 `docs/tech/<technology-name>.md`。这里的依赖包括生产和开发的直接依赖；传递依赖由锁文件记录，额外配置或使用的传递依赖也应单独说明。

- 每种技术按稳定名称维护，例如 `pnpm.md`、`fastify.md`、`pi-sdk.md`。现有技术栈 ADR 保留跨技术选型理由，不能代替新增技术的独立资料。
- 至少记录用途与选型理由、实际版本或服务 API 版本、使用模块、配置入口、验证方式、升级或移除影响及官方资料来源。版本以包清单和锁文件为准；托管服务无固定版本时明确说明。
- 第三方服务还需在 `docs/impl/<service-name>.md` 记录接口或 SDK 使用方式、鉴权与权限、请求/响应映射、错误与超时、重试与幂等、沙箱或替身、联调验证方法。
- tech 回答“为什么引入、版本是什么、在哪里使用”，impl 回答“如何接入并验证”；两者相互链接，共用事实通过引用复用。例如 Pi SDK 的技术资料链接现有 `docs/impl/pi-agent.md`，无需为统一文件名复制一份对接文档。
- 文档只记录配置项与密钥获取方式，不写入真实凭据或敏感业务数据。

### 每个 change 的测试计划

测试计划统一为 `docs/testing/<change-name>.md`，现有 `e2e-strategy.md` 继续维护跨功能的总体测试策略。计划至少包含：

- 对应 change、受影响需求及 spec 的链接。
- requirement/scenario 与测试用例或测试文件的对应关系；尚未实现的用例明确标记待实现。
- 测试层次、前置条件、测试数据与外部服务替身。
- 验证命令、预期结果、实际结果、执行日期及可定位的证据路径。
- 未覆盖或失败场景、原因和关联的后续 change/task。

计划在实现前准备，spec 实现完成后必须同步当前 change 的测试计划与执行证据，再进行归档。区分“计划”“未执行”“通过”“失败”，不能把预期结果当成执行结果。tasks 保存任务状态与证据链接，testing 保存测试细节。归档后保留测试计划原文件名，并将需求文档与测试计划中的 change 链接更新为实际归档路径。

### 自动检查与 Git hook

- `corepack pnpm docs:check` 检查本地 Markdown 链接、feature/spec 同名与互链、活动 change 测试计划、必要章节，以及所有直接 npm 依赖的 tech 文档声明。
- `docs/tech/*.md` 使用 `<!-- tech-packages: package-a, @scope/package-b -->` 声明该文档覆盖的直接依赖；同一技术的配套包可以由一份文档共同说明。
- `.agents/hooks/pre-commit` 使用 Git 暂存区快照运行检查，避免未暂存文档使不完整提交误通过。失败信息会列出缺失项并阻止提交。
- 仓库首次 clone 后执行 `git config core.hooksPath .agents/hooks`。该配置保存在本地 `.git/config`，Git 不会从仓库自动启用 hook；当前工作区在本规范建立时已配置。
- hook 是提交前反馈，CI 仍应运行 `corepack pnpm docs:check`，防止通过 `--no-verify` 或未配置 hook 绕过规则。

## 任务开始

开始实现前，按顺序读取：

1. 根目录 [`AGENTS.md`](../../AGENTS.md) 和[文档地图](../README.md)。
2. 本次活动 OpenSpec change 的 `proposal.md`、delta specs、`design.md` 和 `tasks.md`。
3. 对应 `docs/features/` 需求文档、`docs/testing/<change-name>.md` 测试计划，以及直接相关的架构、技术资料、第三方对接说明、包 README、实现和测试。

若没有对应 change，先按下面的标准迭代流程建立规格和验收场景。不要从历史聊天推测业务要求，也不要用宽泛任务绕过缺失的验收条件。

## 标准迭代流程

1. Explore：阅读现有 specs、代码与测试，明确歧义，不修改实现。
2. Propose：创建一个 kebab-case OpenSpec change，完成 proposal、delta specs、design、tasks；建立或更新同名需求入口，准备对应 change 的测试计划，并将所需文档同步工作纳入 tasks。
3. Review：确认范围、外部行为、非目标、风险和验收场景。
4. Apply：严格按 tasks 逐项实现；每完成一项立即勾选并附验证证据。
5. Verify：运行该变更相关的最小充分测试，再执行合并门禁；在 `docs/testing/<change-name>.md` 同步实际覆盖、结果和证据。
6. Archive：实现、验证及文档同步全部完成后，先同步主 specs，再归档 change，并修复需求文档和测试计划中的归档链接。

同步主 spec 后再归档；只有真实完成且验证通过的任务才能勾选。若当前变更超出已确认范围，先更新 change 并说明影响，再继续实现。

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
- features 与 spec 名称一致，需求与 change 已相互关联，当前 change 的测试计划已准备。

## Definition of Done

- 代码只覆盖 change 声明的范围。
- 领域规则有必要的单元测试；API 变更有集成测试。
- P0 行为有 E2E 或明确的后续任务，不能口头省略。
- 类型检查、格式、测试和构建全部通过。
- 文档、架构图和依赖版本与实现一致。
- 日志和测试产物不包含身份证号、材料正文或密钥。
- OpenSpec tasks 已按真实完成情况更新；未完成项不得勾选。
- 当前 change 的测试计划已同步覆盖、实际结果与证据；新增或变更的技术资料、第三方对接文档及需求链接已更新。

## AI 操作边界

- 修改前先读根 `AGENTS.md`、当前 change 和相邻模块 README。
- 只修改任务直接涉及的文件；发现无关问题只记录，不顺手重构。
- 不让模型决定能否投保、是否核保成功或是否重复提交。
- 不把 prompt 当业务规则；规则必须存在于领域/应用层并能自动测试。
- 外部写操作必须经过用户授权、业务权限和幂等校验。
- 依赖升级、数据迁移和 API breaking change 使用独立 change。

## 会话交接记录

任务暂停或开发会话结束时，把交接信息写入对应 OpenSpec change 的 tasks/design 或 PR 描述：

- 使用的 OpenSpec change 与完成比例。
- 修改的模块和关键决策。
- 已运行的验证命令与结果。
- 未解决问题、复现条件和下一步。
- 关联的 sessionId/runId/traceId（只记录非敏感 ID）。

新接手的人应能直接根据这份记录继续工作。交接不是验收证据：完成状态仍由 tasks 和可重复运行的检查决定，不单独建立无人维护的 session 日志。
