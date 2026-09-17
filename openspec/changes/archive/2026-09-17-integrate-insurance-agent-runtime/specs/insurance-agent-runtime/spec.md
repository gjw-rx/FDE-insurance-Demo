## Purpose

定义独立 `insurance-agent` 服务的配置隔离、Pi SDK 运行边界、只读工具权限以及供业务 API 使用的 run 生命周期与流式事件契约。

## ADDED Requirements

### Requirement: 独立的 insurance-agent 服务进程

系统 SHALL 将 `insurance-agent` 作为可独立启动和部署的服务进程运行，并在该进程内通过 Pi SDK 创建和驱动 Agent session、agent loop 与 runtime。该服务 SHALL NOT 连接当前交互式 Pi 会话，也 SHALL NOT 为处理 run 启动 `pi` CLI 或 RPC 子进程。

#### Scenario: 独立启动服务

- **WHEN** 运维使用有效配置和模型凭据启动 `insurance-agent`
- **THEN** 服务在自身进程内初始化 Pi SDK runtime，健康检查返回 Agent 名称 `insurance-agent`，且不要求存在正在运行的 Pi CLI 进程

#### Scenario: 当前 Pi 会话不存在

- **WHEN** 运行环境没有交互式 Pi 进程或可恢复的开发会话
- **THEN** `insurance-agent` 仍可使用自身 runtime data 和配置处理 run

### Requirement: 应用专属配置与运行数据隔离

系统 MUST 从应用专属配置读取 Agent 名称、模型 provider、model、thinking level、内置工具 allowlist 和 runtime 参数。仓库默认配置 SHALL 声明 `agent.name=insurance-agent`、`provider=opencode-go`、`model=deepseek-flash`、`thinkingLevel=high` 以及 `read`、`grep`、`find`、`ls` 工具。系统 MUST 使用 `insurance-agent` 专属 runtime data 目录保存 SDK 所需的凭据、模型 catalog cache 和 session 数据，且 SHALL NOT 读取或回退到 `.pi/settings.json`、`~/.pi/agent/settings.json`、`~/.pi/agent/models.json`、`~/.pi/agent/auth.json` 或开发会话目录。

#### Scenario: 使用仓库默认配置启动

- **WHEN** 服务加载有效的仓库默认配置且所需 secret 已由部署环境提供
- **THEN** 服务以 `insurance-agent`、`opencode-go/deepseek-flash`、`high` 和只读工具 allowlist 初始化 runtime

#### Scenario: 开发机全局设置不同

- **WHEN** 运行用户的 Pi 全局目录配置了不同模型、工具或 session
- **THEN** `insurance-agent` 的有效配置和运行数据不受这些全局文件影响

#### Scenario: 配置包含明文凭据

- **WHEN** 应用配置中出现 API key、OAuth token 或其他明文 secret 字段
- **THEN** 服务拒绝启动并返回不包含 secret 值的配置错误

#### Scenario: 必填配置无效

- **WHEN** Agent 名称、模型标识、thinking level、工具 allowlist 或 runtime 参数缺失或非法
- **THEN** 服务拒绝进入 ready 状态并返回可定位到配置字段且不泄露敏感值的错误

### Requirement: 模型可用性必须显式验证

系统 MUST 通过应用专属的 Pi SDK `ModelRuntime` 解析模型和凭据，并对独立 model catalog 执行有超时的刷新或恢复。若配置模型不可解析、缺少认证或刷新后不可用，系统 SHALL 将 readiness 标记为失败并拒绝创建新 run，且 SHALL NOT 自动回退到任意其他模型或开发机缓存。

#### Scenario: 模型和凭据可用

- **WHEN** 独立 catalog 中可解析 `opencode-go/deepseek-flash` 且该 provider 的应用凭据有效
- **THEN** readiness 返回 ready，并允许创建新 run

#### Scenario: 模型不可用

- **WHEN** catalog 刷新超时、配置模型不存在或 provider 凭据不可用
- **THEN** readiness 返回 not-ready，新 run 请求收到稳定的服务不可用错误，且服务不选择其他模型

### Requirement: 仅启用 Pi SDK 原生只读能力

系统 SHALL 通过 Pi SDK 原生资源加载器装配项目允许的 skills、上下文和 extensions 生命周期 hook，并且 Agent 可调用的内置工具 MUST 严格限制为 `read`、`grep`、`find`、`ls`。系统 MUST 禁止 `bash`、`edit`、`write` 及未在 allowlist 中的内置工具，也 SHALL NOT 注册 MCP、保险业务 custom tools、sub-agent 或第三方 extension 能力。

#### Scenario: runtime 能力装配

- **WHEN** 服务创建新的 Agent runtime
- **THEN** runtime 可加载允许的项目 skills、上下文和生命周期 hook，并且活动工具集合恰好为 `read`、`grep`、`find`、`ls`

#### Scenario: 模型请求写入或执行命令

- **WHEN** 模型尝试调用 `bash`、`edit`、`write` 或其他未允许工具
- **THEN** 该工具不可被调用，run 不产生 shell 执行或文件写入副作用

#### Scenario: 读取受控工作目录外路径

- **WHEN** 模型通过只读工具请求访问配置工作目录之外的路径
- **THEN** 服务拒绝该工具调用并产生脱敏的工具失败事件，不返回目标文件内容

### Requirement: run 创建与并发控制

业务 API SHALL 能通过内部接口提交业务 `sessionId`、项目生成的 `runId` 和用户消息来创建 Agent run。服务 MUST 校验请求，按配置限制并发运行数，并为每个活动 run 维护独立的 Pi session 关联；项目 `sessionId` 和 `runId` SHALL 保持为对外关联标识，不能由 Pi 内部 session ID 替代。

#### Scenario: 成功创建 run

- **WHEN** 服务 ready、请求字段有效且仍有并发容量
- **THEN** 服务接受请求，返回相同的 `sessionId`、`runId`、Agent 名称和已接受状态，并异步执行 Agent loop

#### Scenario: 重复提交相同 runId

- **WHEN** 同一 `runId` 被再次提交
- **THEN** 服务不启动第二个 Agent loop，并返回已存在 run 的当前状态

#### Scenario: 达到并发上限

- **WHEN** 活动 run 已达到配置并发上限
- **THEN** 新请求收到可重试的容量错误，现有 run 不受影响

### Requirement: 稳定且脱敏的流式事件

服务 SHALL 为每个 run 提供带单调递增 cursor 的 SSE 事件流，并把 Pi SDK 的 agent、turn、message、tool、retry、compaction 和 settled 生命周期映射为稳定的服务事件。事件 SHALL 包含 `agentName`、`sessionId`、`runId`、cursor、事件类型和时间戳；服务 MUST 排除 prompt 原文、thinking 正文、模型凭据、文件内容及未脱敏的工具参数或结果。

#### Scenario: 订阅活动 run

- **WHEN** 业务 API 订阅已接受 run 的事件流
- **THEN** 服务按 cursor 顺序发送 run 生命周期和可公开的回答增量，并最终发送 completed、failed 或 aborted 终态事件

#### Scenario: 使用 cursor 重连

- **WHEN** 订阅方携带最近已确认 cursor 重新连接仍在保留期内的 run
- **THEN** 服务从下一条事件继续发送且不重复已确认事件

#### Scenario: Pi SDK 产生敏感事件字段

- **WHEN** SDK 事件包含 thinking、prompt、文件正文或工具原始输入输出
- **THEN** 对外 SSE 和普通日志不包含这些原始内容，仅保留允许的状态与脱敏元数据

### Requirement: run 可停止且必须收敛到单一终态

业务 API SHALL 能请求停止活动 run。服务 MUST 通过 Pi SDK 的 abort 能力终止当前运行，释放订阅与 session 资源，并保证每个 run 只进入 `completed`、`failed` 或 `aborted` 中的一个终态。

#### Scenario: 停止活动 run

- **WHEN** 业务 API 请求停止仍在执行的 run
- **THEN** 服务调用 SDK abort，最终发出一条 aborted 终态事件并释放该 run 的资源

#### Scenario: 重复停止终态 run

- **WHEN** 业务 API 再次停止已处于终态的 run
- **THEN** 服务不产生第二个终态，也不返回不可预测错误，而是返回该 run 的现有终态

#### Scenario: Agent 执行失败

- **WHEN** provider、SDK runtime、skill/resource 加载或 Agent loop 发生错误
- **THEN** run 收敛为 failed，错误响应和事件使用稳定错误码并排除凭据、prompt、thinking 与文件内容

### Requirement: 自动化验证不依赖真实模型和本机 Pi

系统 MUST 支持使用 fake model/provider、临时 runtime data 目录和受控测试资源验证配置、runtime、工具边界、hooks、HTTP/SSE 与停止行为。自动化测试 SHALL NOT 要求真实模型调用、开发机 Pi 配置或交互式 Pi 进程。

#### Scenario: 隔离环境执行测试

- **WHEN** 测试在没有真实模型凭据且 HOME 中不存在 Pi 配置的隔离环境运行
- **THEN** fake 驱动的配置、runtime 和服务集成测试可重复通过，且不会访问外部模型服务
