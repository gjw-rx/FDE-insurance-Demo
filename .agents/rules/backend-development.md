---
name: backend-development
description: 约束 TypeScript/Node.js/Fastify 后端的目录职责、依赖方向、契约、可靠性、安全与验证方式。
applies_to:
  - apps/api/**
  - apps/insurance-agent/**
  - packages/application/**
  - packages/domain/**
  - packages/contracts/**
---

# backend-development

## 1. 适用范围与优先级

- 修改 `apps/api/**`、`apps/insurance-agent/**` 或后端共享包前，先读取根目录 [`AGENTS.md`](../../AGENTS.md)、项目文档地图和本规则。
- 根目录 `AGENTS.md`、OpenSpec change 和已确认的主 spec 优先于本规则；本规则只约束后端实现方式，不改变产品需求或接口契约。
- 当前后端使用 TypeScript、Node.js ESM、Fastify 和 Vitest。版本以根 `package.json`、`pnpm-lock.yaml`、`tsconfig.base.json` 和对应 `package.json` 为准，不在规则中自行升级或替换工具。

## 2. 当前项目边界

```text
apps/api ──> packages/application ──> packages/domain
    │                 │
    └─────────────────┴──────────────> packages/contracts

apps/api ──HTTP/SSE──> apps/insurance-agent ──> Pi SDK
```

- `packages/domain` 是纯领域模型和业务规则，不依赖 Fastify、Pi SDK、数据库、网络客户端或其他 workspace 包。
- `packages/application` 组织用例和端口，只依赖 `domain` 与 `contracts`；不得放 Fastify 路由或具体 SDK 调用。
- `packages/contracts` 只存跨边界 DTO、事件、错误码和稳定类型，不放领域行为、数据库模型或基础设施实现。
- `apps/api` 是业务 API 组合根，负责配置、依赖装配、HTTP/SSE 路由、输入结构校验、错误映射和基础设施适配器；业务规则仍由 application/domain 拥有。
- `apps/insurance-agent` 是独立进程，负责 Pi runtime、run 生命周期、只读工具门禁和内部 HTTP/SSE；`apps/api` 不直接初始化 Pi SDK。
- 新增模块时先判断它属于领域规则、用例端口、协议适配还是基础设施；不能因为暂时找不到位置就塞进 `bootstrap/` 或建立职责模糊的 `utils/`。

## 3. TypeScript 与代码组织

- 保持 `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 等根 `tsconfig.base.json` 约束；禁止使用 `any`、`@ts-ignore` 或关闭检查来绕过边界。
- 后端使用 ESM + `NodeNext`；相对导入遵守当前项目的扩展名和公开入口约定，workspace 包只从 `exports` 或公开入口导入，不跨包引用 `src` 内部路径。
- 类型按边界定义：HTTP 请求/响应、内部事件、领域对象和持久化记录使用不同模型；不要把数据库记录或领域聚合直接作为公开响应。
- 函数和类保持单一职责。解析、校验、业务决策、外部副作用和响应映射分开，使失败路径可以单独测试。
- 注释解释约束、事实来源和非显然的失败/并发原因；不要用注释重复代码，也不要用 prompt、日志文案或模型回复代替业务规则。
- 依赖新增、升级或移除必须先有对应 OpenSpec 范围，并同步 `docs/tech/<technology>.md`；只维护根 `pnpm-lock.yaml`，从仓库根目录执行安装。

## 4. 输入、契约与业务规则

- Fastify 层只负责协议层结构校验和请求生命周期；application/domain 必须再次校验业务不变量、权限、状态、版本和幂等条件。
- 明确区分字段缺失、`null`、空字符串、空白字符串、零值和显式清空；不要用宽松 truthy 判断代替业务语义。
- 客户端可提交的 ID、状态、权限或计算结果都不是可信事实。服务端从可信上下文和持久化/领域来源重新加载并决定归属、可见性和状态。
- 预期拒绝、依赖故障和意外异常使用稳定的错误类型/错误码区分。对外只返回已约定的脱敏字段和 `retryable` 语义，不返回堆栈、内部地址、原始 provider 错误或 prompt。
- 修改公开 HTTP、SSE 或 workspace contract 时，先更新 `packages/contracts` 与 OpenSpec，再同步 API、调用方、测试计划和相关 README；不能只修改某一端的 DTO。
- SSE/事件流必须使用稳定事件类型、单调 cursor 和明确终态；增量、失败、取消、超时和提前断开分别定义行为，不能从回答文本推断业务状态。

## 5. 可靠性、并发与生命周期

- 任何可能重试或重复提交的写操作都必须有幂等键/业务唯一键，并在副作用前完成重复检查；超时后先查询既有状态，再决定是否重试。
- run、任务或会话状态必须有明确的状态转换和唯一终态。重复创建、重复停止、客户端断开、上游失败和进程关闭都要收敛到可查询结果。
- 异步结果写回前确认仍属于当前操作、版本和资源；较早操作晚返回时不得覆盖较新的状态。使用序号、版本或取消标识表达这种判断，不依赖时序运气。
- 超时、取消、容量不足和依赖不可用必须有边界：停止继续工作、释放本次资源、保留可定位诊断，并向调用方返回稳定可重试语义。禁止无上限重试或静默降级。
- 进程收到 `SIGINT`/`SIGTERM` 时先停止接受新工作，再按顺序停止活动任务、关闭订阅和 HTTP 服务；只清理本进程创建的资源。
- 当前会话仓储为进程内实现，重启丢失是已确认事实。未来引入数据库、队列或跨重启恢复时，必须另建 change，明确迁移、并发一致性、恢复和旧数据兼容规则，不得把内存实现悄悄当成持久化。

## 6. 安全与信任边界

- secret 只从部署环境或明确的 secret provider 注入内存；不得写入源码、配置样例、fixture、日志、SSE、错误响应或测试产物。示例只写变量名和 placeholder。
- `sessionId`、`runId`、资源 ID 和模型输出只是关联数据，不是访问凭证。引入鉴权后，每次资源读取、列表、批量操作和写操作都必须校验主体、资源归属和动作权限，默认拒绝。
- 当前 `insurance-agent` 只启用受控目录内的 `read`、`grep`、`find`、`ls`，禁止 `bash`、任意写文件和任意网络工具；放宽工具集合必须单独评审信任边界、参数、预算和审计字段。
- 引入数据库时查询值必须参数化，动态列名和排序方向只能映射到服务端允许列表；集成测试必须经过真实查询边界，mock DAO 不能证明注入防护。
- 引入 URL、文件上传或子进程时，分别限制协议/地址/重定向、根目录/大小/类型/符号链接和固定程序/参数/预算；不得拼接 shell 命令，不得把用户输入直接变成路径、URL 或进程选项。
- 拒绝必须发生在外部副作用之前；日志和 telemetry 只保留 `sessionId`、`runId`、`traceId`、稳定状态和脱敏错误摘要，不记录身份证号、材料正文、prompt、thinking、文件内容或完整保险公司响应。

## 7. 测试与验证

- 测试放在对应 workspace 的 `test/`，不混入生产 `src/`。测试名称描述用户可观察行为、状态转换或失败边界，不只断言私有实现细节。
- `packages/domain` 和 `packages/application` 优先使用纯单元测试与 fake port；`apps/api` 使用 Fastify `inject` 和本地 fake HTTP/SSE 服务验证路由、错误映射、超时和幂等；`apps/insurance-agent` 使用临时 HOME/runtime 目录与 faux provider，不访问真实模型或开发机 Pi 配置。
- 真实模型 smoke 仅在用户明确提供 `INSURANCE_AGENT_API_KEY` 且 change 将其列为验收条件时运行；日志和证据必须脱敏。普通 `test` 不得隐式访问外部服务、真实数据库、浏览器或生产资源。
- 按改动范围选择最小充分验证：
  - 契约或共享类型：`corepack pnpm --filter @renewal/contracts typecheck` 与 `corepack pnpm --filter @renewal/contracts test`。
  - API 路由、应用服务或 API 适配器：`corepack pnpm verify:api`。
  - Agent runtime、配置、生命周期或只读门禁：`corepack pnpm --filter @renewal/insurance-agent typecheck`、`corepack pnpm --filter @renewal/insurance-agent test`。
  - 跨 API/Agent/Web 或 OpenSpec change：`corepack pnpm verify:change <change-name>`，并同步 `docs/testing/<change-name>.md`。
- 验证结果必须记录真实命令、退出码、通过/失败/未执行状态和可定位日志；修改后重跑受影响检查，不把旧版本结果当作当前版本证据。相同输入连续失败两次时先读完整日志，再用 `--retry-reason` 记录新的环境或取证变化。
- 发现失败时先判断是实现、契约、环境还是测试替身问题；修复后保留失败原因、修改范围和复跑结果。不得通过增加重试、放宽断言或隐藏日志掩盖稳定失败。

## 8. 开发流程与完成标准

- 开始任务前读取 `docs/README.md`、`docs/engineering/ai-workflow.md`、相关 `docs/features/`、活动 change 的 `proposal.md`/`design.md`/`tasks.md`，以及受影响包 README 和 `docs/tech`/`docs/impl`。
- 涉及用户可观察行为或跨模块边界的修改必须走 OpenSpec 的 Explore → Propose → Review → Apply → Verify → Archive；没有对应 change 时先建立范围和验收场景。
- 代码、契约、配置、架构、测试计划和技术资料保持同步。发现当前实现与 spec 或 README 不一致时修正事实来源或实现，不能只改文档让检查通过。
- 完成前至少确认：依赖方向未反转、公开契约已同步、敏感数据未进入日志、领域规则有测试、API 失败语义可定位、相关 typecheck/test/verify 已真实执行；未执行项保持“未执行”，不得写成通过。
- 不在本规则中假设尚未选择的数据库、ORM、身份 provider、队列、CI provider 或部署目标；引入这些能力时，先建立独立设计与安全/可靠性验收，再补充对应 owner 文档。
