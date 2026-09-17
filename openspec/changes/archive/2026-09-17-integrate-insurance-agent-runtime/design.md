## Context

见 [proposal.md](./proposal.md) 的动机与范围，以及 [insurance-agent-runtime delta spec](./specs/insurance-agent-runtime/spec.md) 的行为契约。

当前仓库是 pnpm workspace，`apps/api` 只有 Fastify 与基础设施目录骨架；Pi SDK `0.85.1` 已作为其直接依赖安装，但没有适配器实现。现有 [Pi Agent 对接设计](../../../docs/impl/pi-agent.md) 把 SDK 定为首选嵌入方式，并要求业务 `sessionId`、`runId` 与 Pi 内部 session ID 分离；[系统设计](../../../docs/arch/system-design.md) 禁止通用 shell、文件写入和任意网络工具。

官方 SDK 提供 `ModelRuntime`、`AgentSessionRuntime`、`SessionManager`、`SettingsManager`、`DefaultResourceLoader`、Agent 事件订阅、skills、inline extensions 和内置工具。它不会自动连接当前 Pi 会话，也不会自动启动 Pi CLI；但默认构造会读取 `~/.pi/agent`。隔离实验进一步确认：使用全新的 `authPath`、`modelsPath` 和 `modelsStorePath` 时，`opencode-go` provider 可注册，但 `deepseek-flash` 在独立 catalog 刷新或恢复前不可解析，因此启动阶段必须显式处理 catalog 与认证，不能依赖开发机缓存。

Pi `0.85.1` 明确不内置 MCP、sub-agent、权限弹窗或后台 shell；这些能力可由 extensions 构建，但均不在本 change 范围。自动化测试必须避免真实 provider 调用和本机 HOME 污染。

## Goals / Non-Goals

**Goals:**

- 建立独立 `insurance-agent` workspace 服务，使进程、端口、配置、runtime data、session 和部署生命周期均可与 `apps/api` 分开。
- 用 SDK 原生对象完成模型解析、Agent session/runtime、loop、事件订阅、skills/resource loading、extensions hooks 和只读内置工具装配。
- 提供可由业务 API 调用的最小 HTTP/SSE 契约，并把 SDK 事件收敛为稳定、脱敏、可从 cursor 续接的服务事件。
- 通过应用配置和显式 SDK 参数阻止任何对当前 Pi CLI 配置、会话和凭据目录的隐式回退。
- 让配置、工具权限、事件映射、停止和失败路径均可在 fake provider 下自动验证。

**Non-Goals:**

- 不复刻 Pi TUI、RPC mode、完整命令系统或 `/model`、`/resume` 等交互式能力。
- 不支持 MCP、custom tools、第三方 extensions、sub-agent 或任意 shell/写文件能力。
- 不在此阶段建立业务 session/消息数据库；run 状态和 SSE replay buffer 为单进程内存状态，服务重启后不恢复。
- 不定义 Web 公开 API 和前端消息渲染；业务 API 与前端的完整会话产品行为由后续 change 管理。
- 不自动安装 skill/package，不从用户 HOME 发现资源，也不通过配置执行命令获取 secret。

## Decisions

### D1: 新建 `apps/insurance-agent`，SDK 依赖从业务 API 运行边界迁出

- **做法**：新建 workspace 包 `@renewal/insurance-agent`，使用 Fastify 暴露内部 HTTP/SSE；该包直接依赖锁定版本 `@earendil-works/pi-coding-agent@0.85.1`、`fastify@5.12.4` 和 `@renewal/contracts`。`apps/api` 保留业务 API 职责，只通过一个基础设施 client 调用 Agent 服务；不在 `apps/api` 进程内创建 SDK runtime。若 `apps/api/package.json` 不再直接导入 SDK，则移除该处直接依赖，避免两个组合根都能启动 Agent。
- **理由**：用户要求部署后有明确区分并以 `insurance-agent` 命名。独立进程可单独扩缩、限流、熔断和回滚，也避免模型故障或 Agent loop 阻塞业务 API event loop 的责任边界。
- **备选**：继续把 SDK 嵌在 `apps/api`（部署和配置无法清晰隔离）；启动 `pi --mode rpc` 子进程（违反“所有能力通过 SDK 实现”，还引入 CLI 生命周期与 JSONL 协议）。

建议目录：

```text
apps/insurance-agent/
├── package.json
├── README.md
├── tsconfig.json
├── src/
│   ├── bootstrap/        # 配置、runtime data、Fastify 装配与启动
│   ├── config/           # 应用配置类型、校验、环境 secret 注入
│   ├── runtime/          # Pi SDK factory、run registry、事件映射
│   └── interfaces/http/  # health/readiness、run、events、abort 路由
└── test/                 # 测试与 fixture，按生产模块镜像分层
```

### D2: 使用应用专属 JSON 配置和独立 runtime data 根

- **做法**：新增仓库配置 `config/insurance-agent.json`，建议结构如下；启动入口默认读取该文件，部署可用 `INSURANCE_AGENT_CONFIG_PATH` 指向环境专属非敏感配置。

```json
{
  "agent": {
    "name": "insurance-agent",
    "workingDirectory": "."
  },
  "model": {
    "provider": "opencode-go",
    "id": "deepseek-flash",
    "thinkingLevel": "high",
    "apiKeyEnv": "INSURANCE_AGENT_API_KEY",
    "catalogRefreshTimeoutMs": 15000
  },
  "runtime": {
    "dataDirectory": ".runtime/insurance-agent",
    "maxConcurrentRuns": 4,
    "runTimeoutMs": 300000,
    "eventRetentionMs": 900000,
    "maxEventsPerRun": 1000
  },
  "tools": {
    "allow": ["read", "grep", "find", "ls"]
  },
  "resources": {
    "skillPaths": [],
    "contextPaths": []
  },
  "http": {
    "host": "127.0.0.1",
    "port": 4310
  }
}
```

- **校验**：配置解析采用严格对象白名单和显式类型/范围检查；拒绝 `apiKey`、`token`、`secret`、`auth` 等明文凭据字段。相对路径以配置文件所在目录或明确的仓库根解析，不以调用者当前 cwd 猜测。有效配置对象在日志中只能输出非敏感摘要。
- **runtime data**：`ModelRuntime.create()` 显式设置 `<dataDirectory>/auth.json`、`models.json`、`models-store.json`；`SessionManager` 使用该目录下受控 session 路径或内存 session。该目录加入 `.gitignore`。不调用 `getAgentDir()`，也不把 `~/.pi/agent` 作为 fallback。
- **secret**：启动代码读取 `apiKeyEnv` 指向的环境变量后，通过 SDK runtime credential override 注入；配置只保存环境变量名。若 provider 后续改用独立 secret store，其适配仍落在启动层，不改变配置和运行契约。
- **理由**：`.pi/settings.json` 是 Pi CLI 的项目设置，部署时仍可能与工具自身配置混淆；应用专属配置可以版本化非敏感默认值，同时让数据目录和 secret 生命周期独立。
- **备选**：复用 `.pi/settings.json`（用户已明确拒绝）；复制 `models.json`/`auth.json` 到仓库（泄密且把 SDK runtime state 当配置）；只用环境变量配置全部字段（缺少可审查的项目默认配置）。

### D3: 模型启动采用“独立 catalog + 有界刷新 + 无回退”

- **做法**：启动时创建专属 `ModelRuntime`，先从独立 `models-store.json` 恢复 catalog（`refreshOnCreate: false`），再在 `catalogRefreshTimeoutMs` 内通过 SDK refresh 更新配置 provider；随后严格解析 `provider/id`、检查认证可用性并固定 thinking level。
- **刷新失败即 not-ready**：刷新超时、刷新报错、配置模型不可解析或缺少认证，一律将 readiness 标记为 not-ready 并拒绝新 run（与 delta spec 的“模型不可用”场景一致）。首版不采用“缓存降级继续 ready”的降级路径：catalog 未确认时不接流量，避免部署环境静默使用陈旧模型目录。
- **无回退**：不让 `createAgentSession` 自行选择“第一个可用模型”，而是始终传入解析成功的配置模型。
- **理由**：隔离实验表明 provider 注册不等于 model 已在独立 catalog 可解析。显式 readiness 能避免开发环境“碰巧可用”、部署环境静默换模型。
- **备选**：把完整模型元数据硬编码进配置（与 provider catalog 演进重复且易过期）；直接复用 HOME 缓存（破坏隔离）；自动降级到其他模型（行为和成本不可控）；刷新失败时用缓存继续服务（与 spec 的模型可用性要求冲突，且会让陈旧 catalog 持久生效）。

### D4: 每个 run 使用独立、短生命周期的 SDK runtime

- **做法**：run registry 以项目 `runId` 为主键。接受请求后，为该 run 创建 `SessionManager.inMemory(controlledCwd)` 和独立 `AgentSessionRuntime`，保存 `piSessionId` 仅作诊断关联；订阅事件后调用 `session.prompt()`。run 完成、失败、超时或 abort 后解除订阅并 `dispose()`。
- **并发**：全局 semaphore 按 `maxConcurrentRuns` 限制活动 runtime；同一 `runId` 的重复 POST 返回现有快照，不重复调用模型。首版不同 run 不共享 Pi message history，业务 `sessionId` 只用于关联；跨 run 连续对话和持久恢复留给实现 Conversation bounded context 的后续 change。
- **超时**：每个 run 使用服务级 deadline；超时路径调用 `session.abort()`，并统一收敛到 `aborted`（原因 `timeout`），不让 promise 或 provider stream 悬挂。
- **理由**：当前没有业务会话存储，用 session 复用会引入未定义的顺序、恢复和并发语义。每 run 隔离是满足当前接口、易测试且故障域最小的实现。
- **备选**：全服务单一 runtime（会串上下文且无法安全并发）；按业务 session 长期缓存 runtime（需先定义持久化、串行队列和重启恢复）；直接只用 `createAgentSession()`（能运行 loop，但不落实用户明确要求的 runtime 层装配）。

### D5: 资源发现采用显式 allowlist，不使用 ambient HOME discovery

- **做法**：用 SDK `SettingsManager.inMemory()` 构造运行设置；`DefaultResourceLoader` 的 `agentDir` 指向专属 runtime data，cwd 指向配置的受控工作目录，并用 resource override/filter 只保留 `resources.skillPaths`、`resources.contextPaths` 和服务内置 inline extension。启动时先 `reload()` 并将资源 diagnostics 纳入 readiness。默认 skill/context 路径为空；测试通过 fixture 验证 SDK 原生 skill 加载。
- **项目信任**：服务是非交互模式，不触发或依赖 Pi CLI 的 trust prompt；应用配置本身就是资源授权边界。禁止自动安装 package 和从 `~/.agents/skills`、用户级 extensions、`.pi/settings.json` 发现资源。
- **理由**：SDK 默认 resource discovery 适合交互式编码 Agent，但服务端必须可复现且不能让部署用户 HOME 改变能力。
- **备选**：完整默认 discovery（会加载未知全局 skill/extension）；自写 skill 解析器（绕开 SDK，与“通过 SDK 实现”冲突）。

### D6: 只用 SDK 内置只读工具，并由 inline extension 加第二层路径门禁

- **做法**：创建 session 时显式传入 `tools: ["read", "grep", "find", "ls"]`，不依赖 SDK 默认工具集合。服务内置 inline extension 在 `tool_call` hook 中对四类工具的路径参数做 canonicalize，并验证真实路径位于配置的工作目录内；拒绝绝对路径逃逸、`..` 逃逸和 symlink 逃逸。事件与日志只记录 tool name、结果状态、耗时和脱敏错误码，不记录参数或内容。
- **理由**：工具 allowlist 落实已有架构安全边界；hook 路径门禁防止“只读”变成读取宿主凭据。inline extension 仍是 Pi SDK 原生 extension 能力，不是 custom tool 或第三方 extension。
- **备选**：只传工具名、不限制路径（可读取工作目录外敏感文件）；重写四个 custom tools（没有必要且偏离内置工具要求）；启用 `bash` 后做命令黑名单（不可可靠约束）。

### D7: SDK session events 与 extension hooks 分工明确

- **做法**：
  - `session.subscribe()` 负责 Agent loop 的 message delta、turn、tool execution、retry、compaction 和 settled 等事件采集。
  - 服务内置 `extensionFactories` 负责 `session_start`/`session_shutdown`、`before_agent_start`、`tool_call` 门禁及 hook 可用性验证。
  - `RunEventMapper` 把两路输入去重后转换为 `@renewal/contracts` 中的判别联合类型；每个 run 使用单调 cursor，事件先写入有界 ring buffer，再广播 SSE。
- **公开事件**：至少包含 `run.accepted`、`agent.started`、`answer.delta`、`turn.completed`、`tool.started`、`tool.completed`、`retry.started`、`compaction.started`、`run.completed`、`run.failed`、`run.aborted`。不透传 SDK 原始对象；`thinking_delta` 丢弃，tool args/result 丢弃，普通日志也不记录 answer 正文。
- **终态**：registry 用一次性 compare-and-set 结束 run，保证 abort、超时、provider error 和正常完成竞争时仅写入一个终态。
- **理由**：SDK 事件类型会随版本演进，对外透传将耦合调用方并泄露敏感字段；稳定映射层允许内部升级。
- **备选**：原样转发 SDK event（不稳定且不安全）；只使用 hooks（缺少完整 message streaming）；只使用 subscribe（无法在执行前实施路径门禁）。

### D8: HTTP/SSE 是内部服务契约，业务 API 使用 typed client

- **做法**：Agent 服务提供：

| Method | Path                                                | 语义                                              |
| ------ | --------------------------------------------------- | ------------------------------------------------- |
| `GET`  | `/health/live`                                      | 进程存活，不代表模型可用                          |
| `GET`  | `/health/ready`                                     | 配置、资源、catalog、模型与凭据均可用             |
| `POST` | `/internal/agent/runs`                              | 接受 `{sessionId, runId, message}`，返回 202 快照 |
| `GET`  | `/internal/agent/runs/:runId/events?after=<cursor>` | SSE replay + live stream                          |
| `POST` | `/internal/agent/runs/:runId/abort`                 | 幂等停止并返回当前快照                            |

请求/响应、错误码、run 状态和事件类型定义在 `packages/contracts/src/agent/`。`apps/api/src/infrastructure/agent/` 实现 typed client，设置连接/响应超时并把 Agent 服务错误转换为应用端口错误；本 change 不新增面向浏览器的路由。生产部署默认不暴露 Agent 端口到公网，并通过平台网络策略或服务凭证保护 `/internal`；凭证机制由部署环境决定，不把 token 写入仓库。

- **SSE**：支持 `after` query，并兼容 `Last-Event-ID`；ring buffer 超出或 run 已清理时返回明确的 `EVENT_CURSOR_EXPIRED`/`RUN_NOT_FOUND`，不静默从头发送。连接断开只解除该 subscriber，不自动 abort run。
- **理由**：内部契约既能完成 `apps/api -> insurance-agent` 闭环，又避免在 Conversation bounded context 尚未实现时虚构公开业务 API。
- **备选**：共享内存调用（无法独立部署）；Web 直连 Agent 服务（绕过业务鉴权和状态）；本 change 同时实现公开会话 API（范围过大）。

### D9: 内存 registry 与 replay buffer 使用明确上限

- **做法**：每个 run 的事件数、保留时间、回答增量大小和活动 run 总数均使用配置上限；终态 run 在 `eventRetentionMs` 后清理。SSE 慢消费者采用有界发送队列，超限时断开并要求从 cursor 重连。`message`、runId 和 sessionId 设置长度限制。
- **理由**：Pi 输出与事件数量不可由调用方完全控制，无界缓存会造成服务内存风险。
- **备选**：首版直接写数据库/消息队列（当前没有持久化选型，超出 change）；无界数组（不可接受）。

### D10: 测试通过 SDK 注入点和 fake provider 完成，不 mock 整个适配器

- **做法**：runtime factory 接收可替换的 `ModelRuntime`/provider、时钟和 ID-independent fixtures；测试注册一个本地 fake streaming provider，驱动文本、tool call、错误、等待与 abort。临时目录分别作为 config、runtime data、working directory 和 HOME。HTTP 集成测试通过 Fastify inject 或本地监听验证 JSON/SSE；另写 `apps/api` typed client contract 测试。
- **覆盖重点**：配置严格校验与 secret 拒绝、HOME 隔离、catalog/model not-ready、精确工具集、路径/符号链接逃逸、skill fixture 加载、hook 触发顺序、duplicate runId、并发上限、cursor replay/expired、敏感字段过滤、abort/timeout/正常完成终态竞争、资源 dispose。
- **真实 smoke**：仅提供人工或受控部署 smoke 命令，要求显式 secret；不进入默认 CI，也不得把输出正文记录到测试证据。
- **理由**：mock 掉 SDK 只能证明自有代码，不能证明 SDK runtime/loop/hook/tool 装配；真实模型测试则慢、不稳定、收费且可能泄露环境信息。

### 文档与架构同步

- 新增 `docs/features/insurance-agent-runtime.md`，链接本 capability、change 和测试计划。
- 新增 `docs/testing/integrate-insurance-agent-runtime.md`，实现前标注计划/待实现，实现后记录实际命令与证据。
- 更新 `docs/impl/pi-agent.md`：从“SDK 建议链路”补充为独立 Agent 服务契约、配置/凭据、错误、超时、幂等、事件映射和联调方式。
- 更新 `docs/tech/pi-sdk.md`：保持版本 `0.85.1`，补充实际使用包、runtime 构造、catalog 和验证方式；不宣称 MCP 是原生能力。
- 更新 `docs/arch/system-design.md` 及 `artifacts/architecture/`：将 `apps/api` 与 Pi Agent Runtime 之间改为跨进程 HTTP/SSE 边界，保留只读工具和业务状态边界。
- 更新 `apps/api/README.md` 并新增 `apps/insurance-agent/README.md`；直接依赖归属变化同步 package manifest、lockfile 与 tech package 声明。

## Risks / Trade-offs

- [独立进程增加部署、端口和故障处理复杂度] → 提供独立 liveness/readiness、typed client、超时和明确回滚边界；默认只监听 loopback，生产由服务网络管理。
- [`opencode-go/deepseek-flash` 在空 catalog 中不可直接解析] → 启动时恢复专属缓存并有界 refresh；无可用模型时 not-ready，禁止静默回退。- [只读工具仍可能读取宿主敏感文件] → 固定 cwd、canonical path + realpath 检查、symlink 逃逸测试、事件/日志不记录内容；部署再使用最小权限用户和文件系统隔离。
- [DefaultResourceLoader 的 ambient discovery 可能引入用户 HOME 资源] → 使用专属 agentDir、内存 settings 和显式 allowlist/filter；测试在污染 HOME 下断言未加载外部资源。
- [SDK 事件和 hook 同时采集可能重复或乱序] → mapper 为每类来源定义唯一职责，以服务 cursor 作为唯一外部顺序，并做终态 compare-and-set。
- [SSE 内存 replay 在进程重启后丢失] → spec 明确首版仅进程内保留；调用方收到 `RUN_NOT_FOUND` 后由业务层决定重试，不伪造恢复。持久事件存储后续单独设计。
- [每 run 创建 runtime 有启动开销] → 首版优先隔离和正确性；共享只读 model catalog/credential runtime 数据，测量后再决定 session 池化，不提前引入复杂生命周期。
- [Agent 回答本身可能复述用户敏感数据] → SSE 只面向受保护的业务 API且不写普通日志；内容级 DLP 和业务脱敏策略留给定义消息产品行为的后续 change。
- [慢 SSE 消费者导致内存增长] → 有界 ring buffer 和 subscriber queue，超限断开并从 cursor 重连。

## Migration Plan

1. 先加入 contracts、配置校验和 `apps/insurance-agent`，在 fake provider 下完成进程内测试，不改变现有 Web 行为。
2. 加入内部 HTTP/SSE 与 `apps/api` typed client；默认不开启任何浏览器路由，现有静态工作台继续独立运行。
3. 部署时为 `insurance-agent` 创建独立 runtime data volume、最小权限服务用户、模型 secret 和内部网络策略；先用 readiness 与受控 smoke 验证 catalog、认证和单次 run。
4. 业务 API 只有在 Agent 服务 ready 后才启用后续依赖功能；本 change 本身不切换现有用户流量。
5. 回滚时停止业务 API 对 Agent client 的调用并下线 `insurance-agent`；由于没有数据库迁移和现有用户行为切换，无需数据回滚。保留 runtime data volume 仅用于排障时也不得导出 prompt 或文件正文。
