## Context

项目当前没有应用代码。参见 [proposal.md](./proposal.md) 的动机和三个能力规格。首期需要建立前端、业务 API、领域模型、Pi 适配边界和自动化测试基线，同时保持真实 OCR、数据库、知识库与保险公司集成可后续接入。

## Goals / Non-Goals

**Goals:**

- 用一个 pnpm workspace 管理所有 TypeScript 工程并锁定工具版本。
- 让领域规则不依赖 React、Fastify、Pi SDK 或存储实现。
- 用后端业务 sessionId 统一串联用户交互、续保案件、Agent 运行和诊断链路。
- 提供 Web/API 与领域包的目录、配置和依赖骨架，使后续用例能按统一边界快速迭代。

**Non-Goals:**

- 本次不实现领域实体、应用用例、Web 页面、HTTP 路由、Pi 适配器、自动化测试或任何真实业务逻辑。
- 本次不实现真实 OCR、保险公司核保、支付、出单或生产级知识向量检索。
- 本次不设计多租户权限模型和生产部署拓扑。
- Pi 不直接拥有业务状态，也不允许访问通用 shell、文件或网络工具。

## Decisions

### pnpm workspace 管理单仓库

根目录使用一个 `pnpm-lock.yaml`，内部包只通过 `workspace:*` 引用，并禁止 workspace 依赖环。相比 npm workspaces，pnpm 能显式拒绝错误的本地包解析并保持更严格的依赖可见性；相比 Yarn Berry，不引入 Plug'n'Play 的额外兼容面；首期不增加 Turborepo，因为项目任务量不足以证明远程缓存和独立编排的成本。

### Node.js 24 + TypeScript strict + ESM

使用 Node.js 24 LTS 作为运行时基线、TypeScript strict 模式和 Node ESM。根配置统一类型规则，各包自行声明输入输出目录。版本通过 `packageManager`、`engines`、`.nvmrc` 和锁文件固定。

### React + Vite 前端，Fastify API

前端采用 React 与 Vite，适合纯客户端工作台和 SSE 流式更新。API 使用 Fastify，借助 JSON Schema/TypeBox 保持请求边界校验和 TypeScript 类型一致。未选择 Next.js，因为当前没有 SSR、服务端组件或内容站点需求；未选择 NestJS，因为首期 DDD 边界可由目录和依赖规则表达，无需引入装饰器、反射和大型模块系统。

### DDD 分层与依赖方向

`packages/domain` 包含实体、值对象、领域错误和业务状态机；`packages/application` 包含用例与端口；`apps/api` 组合适配器、HTTP 路由和进程生命周期；`apps/web` 只消费 `packages/contracts` 的 DTO。依赖方向固定为外层指向内层，领域层不依赖任何框架。

### Pi 作为受控基础设施适配器

应用层定义 `AgentRuntime` 端口；Pi SDK 适配器在 API 基础设施层实现该端口。只注册保险业务工具，禁用通用编码工具。业务工具接收案件或报价 ID，由应用服务重新加载并校验真实数据。开发与测试阶段使用内存/假 Agent；本次只确定适配边界和依赖位置。

### 两条消息执行路径

意图路由把续保办理送入 Pi Agent loop，把保险知识咨询送入独立快速问答用例。快速问答由一次检索和一次生成组成，不加载续保工具。两条路径可以共享业务 sessionId 和 UI 时间线，但拥有不同 runId 与执行资源。

### 业务会话 ID 是统一查询主键

服务端生成 `sessionId`，并记录 `renewalCaseId`、`piSessionId`、`runId`、`traceId`、`insurerRequestId`。Pi `sessionId` 只用于恢复 Agent 上下文和诊断，不代替业务授权、案件状态或幂等记录。

### 分层测试

Vitest 覆盖领域规则与 Fastify 注入式 API 集成测试；Playwright 通过真实启动的 Web/API 验证用户旅程。真实 Pi、OCR、知识库和保险公司以契约测试与沙箱 smoke test 验证，不进入每次本地 E2E。

## Risks / Trade-offs

- [Pi SDK 当前迭代较快，包名已迁移] → 锁定精确版本，将 SDK 限制在单一适配器，并保留 RPC 适配方案。
- [内存适配器会掩盖进程重启问题] → 领域和应用测试只验证规则，持久化接入时补充数据库集成与恢复测试。
- [意图分类错误可能把问答送入办理路径] → 办理工具仍执行服务端授权与完整性门禁，分类错误不能绕过业务规则。
- [SSE 断线可能丢失展示事件] → 事件持久化后使用游标续传，页面恢复时总是重读案件快照。
- [个人身份信息进入日志或模型上下文] → DTO、日志和工具输出默认脱敏，仅按最小必要原则传递字段。

## Migration Plan

1. 建立单仓库、DDD 包和内存适配器，保持无外部服务即可启动。
2. 接入持久化和对象存储，将内存端口替换为数据库适配器。
3. 在沙箱环境接入 OCR、知识库和单家保险公司适配器。
4. 接入 Pi SDK 真实运行时并执行工具权限、恢复、超时与追踪验收。

每一步均可通过切回前一适配器回滚，不改变领域与应用层契约。
