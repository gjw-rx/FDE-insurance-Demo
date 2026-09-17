## Why

当前 `apps/api` 仅声明了 Pi SDK 依赖和适配器目录，没有可运行的 Agent 进程、稳定调用接口或与开发机 Pi 配置隔离的模型配置。需要建立独立的 `insurance-agent` 服务，让业务 API 能通过受控接口启动和停止 Agent run、接收流式事件，同时确保部署环境不会隐式复用当前 Pi CLI 进程、会话或 `~/.pi/agent` 配置。

## What Changes

- 新增独立部署、独立启动的 Node.js 服务进程 `insurance-agent`，在进程内嵌入 `@earendil-works/pi-coding-agent` SDK；不启动或连接交互式 Pi CLI/RPC 子进程。
- 通过 Pi SDK 原生能力实现 Agent session、agent loop、`AgentSessionRuntime`、事件订阅、skills/resource loader、extensions 生命周期 hooks 和内置工具装配。
- 只启用 Pi 内置只读工具 `read`、`grep`、`find`、`ls`；禁用 `bash`、`edit`、`write`，不注册保险业务 custom tools。
- 为业务 API 提供最小内部 HTTP/SSE 契约：健康检查、创建 run、订阅 run 事件和停止 run；对外仍由业务 API 承担鉴权、业务会话和错误转换。
- 新增应用专属项目配置，固定 `agent.name=insurance-agent`，默认模型为 `opencode-go/deepseek-flash`，默认 thinking level 为 `high`，并声明只读工具及 runtime 参数。
- 配置加载显式隔离 Pi CLI 的 `.pi/settings.json`、`~/.pi/agent/settings.json`、会话和凭据；模型密钥仅通过部署环境变量或 secret 注入，不写入仓库配置。
- 把 Pi SDK 事件和 extensions 生命周期 hook 映射为稳定、可重放顺序明确的服务事件；过滤 thinking 正文、prompt、工具原始结果及其他敏感内容。
- 增加 fake model/provider 驱动的单元与集成测试，不以真实模型或开发机 Pi 配置作为自动化测试前置条件。

### 非目标

- 不接入 MCP；Pi SDK `0.85.1` 没有内置 MCP，本 change 不自建 MCP bridge。
- 不新增第三方 Pi extensions、sub-agent、后台 shell、权限弹窗等非 SDK 内置能力。
- 不实现续保报价、核保、材料识别等保险业务工具，不让模型成为业务状态来源。
- 不改造 Web 对话区，不在本 change 实现浏览器到业务 API 的完整交互。
- 不共享或迁移当前开发环境的 Pi 会话、全局 settings、models 或 auth 文件。
- 不把 API key、OAuth token 或其他凭据提交到配置文件。

## Capabilities

### New Capabilities

- `insurance-agent-runtime`: 定义独立 `insurance-agent` 服务的配置隔离、Pi SDK 运行、只读工具边界、HTTP/SSE 生命周期与失败行为。对应需求入口为 `docs/features/insurance-agent-runtime.md`。

### Modified Capabilities

（无：现有 `workbench-shell` 仍保持无后端依赖的本地交互，本 change 不改变其 requirement。）

## Impact

- 代码：新增独立 Agent 服务应用及其配置加载、Pi SDK runtime、资源加载、事件映射和内部 HTTP/SSE 接口；`apps/api` 增加调用该内部服务的适配器或最小代理入口。
- API：新增服务间健康检查、run 创建、SSE 订阅和停止契约；run/session 标识由项目生成并与 Pi 内部 session ID 分离。
- 配置：新增应用专属 `insurance-agent` 配置与对应 TypeScript 校验；环境变量只承载密钥和部署覆盖值，不回退读取 Pi CLI 全局配置。
- 依赖：复用 `apps/api` 已锁定的 `@earendil-works/pi-coding-agent@0.85.1`；若独立 workspace 应用需要直接使用该 SDK，则移动或补充直接依赖声明，但不升级版本。
- 安全：仅暴露只读内置工具；工作目录固定在受控目录；服务间接口需受网络边界或服务凭证保护，SSE 与日志不得泄露 prompt、thinking、文件内容或模型凭据。
- 文档：新增 `docs/features/insurance-agent-runtime.md`、`docs/testing/integrate-insurance-agent-runtime.md`，更新 `docs/impl/pi-agent.md`、`docs/tech/pi-sdk.md`、`docs/arch/system-design.md`、相关 README；如运行边界或数据流变化，同步更新 `artifacts/architecture/` 图源与导出产物。
