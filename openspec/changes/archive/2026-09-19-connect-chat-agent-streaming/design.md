## Context

见 [proposal.md](./proposal.md) 的动机与范围，以及 [agent-chat-streaming delta spec](./specs/agent-chat-streaming/spec.md) 和 [workbench-shell delta spec](./specs/workbench-shell/spec.md) 的行为契约。

当前 `apps/web` 是 React/Vite 静态工作台：`ChatComposer` 自己持有输入状态，发送时只清空文本；消息区只有一条静态欢迎消息。`apps/web/src/shared/api/` 已预留但没有实现。Web 只允许依赖 `@renewal/contracts`，HTTP/SSE 通用处理应位于 `shared/api/`，对话状态与事件到 UI 的映射属于 `features/chat/`。

`apps/api` 已依赖 Fastify、`@fastify/cors` 和 `@renewal/contracts`，并已有 `AgentServiceClient`，可以向 `insurance-agent` 创建 run、订阅 SSE 和停止 run；但 API 没有启动入口或浏览器路由。`insurance-agent` 已实现 `POST /internal/agent/runs` 与 `GET /internal/agent/runs/:runId/events`，事件通过有界内存缓冲按 cursor 重放，终态后关闭。现有 run 每次使用独立 Pi session，因此相同业务 `sessionId` 暂不提供跨 run 对话上下文。

本 change 不引入数据库、身份系统、部署网关或新依赖。浏览器不得直接访问内部 Agent 服务，也不得把模型回复当作报价、核保或其他业务事实。

## Goals / Non-Goals

**Goals:**

- 用现有 contracts 和 Agent typed client 建立最薄的 `Web → API → insurance-agent` 文本请求链路。
- 让 API 可独立启动、校验公开请求并把内部 SSE 原样映射为稳定 `AgentRunEvent`，同时正确处理断开和终态。
- 让前端用单一活动 run 状态追加用户消息、增量构建一条助手消息，并在成功或失败后恢复输入。
- 在 fake Agent 服务和浏览器网络 mock 下自动验证 API、SSE 与用户可观察行为，不要求真实模型凭据。

**Non-Goals:**

- 不实现会话/消息/run 持久化、刷新恢复、SSE cursor 重连、跨 run Pi 上下文或多标签页协调。
- 不实现鉴权、授权、限流、CSRF、防滥用、生产 TLS 或服务间认证；公开路由仅用于当前最小联调，生产暴露前需后续安全 change。
- 不实现并发消息、取消/停止按钮、自动重试、Markdown 渲染、文件上传或材料处理。
- 不改变 `insurance-agent` 的内部 HTTP/SSE 契约、模型配置、工具权限或运行时行为。
- 不新增 npm 依赖，也不扩展报价、保司选择等非对话功能。

## Decisions

### D1: API 只做公开协议适配，不新增应用用例或 Pi runtime

- **做法**：在 `apps/api` 增加 Fastify application factory、HTTP 路由和进程启动入口。`POST /api/chat/runs` 校验并转发 `AgentRunCreateRequest`；`GET /api/chat/runs/:runId/events` 调用现有 `AgentServiceClient.streamEvents()`，把每个事件编码成 `id: <cursor>\ndata: <json>\n\n`。API 不保存消息、不解释回答内容，也不直接依赖 Pi SDK。
- **理由**：当前目标只是打通链路，现有 typed client 已封装 Agent 地址、超时、错误和内部 SSE 解析。增加 Conversation application/domain 层会提前定义尚未要求的持久化和业务语义。
- **备选**：Web 直连 `insurance-agent`（绕过业务 API、安全和未来会话边界）；在 API 内初始化 Pi SDK（破坏独立服务架构）；现在建立完整 Conversation bounded context（超出最小实现）。

### D2: 公开接口复用现有 Agent contracts

- **做法**：创建请求、run 快照、事件判别联合与可安全转发的服务错误继续使用 `@renewal/contracts/agent`。API 对缺失、空白或类型错误的字段返回 HTTP 400 和 `INVALID_REQUEST`；已有 Agent 服务错误保留其稳定 code 与 retryable，连接、超时或非法上游协议统一映射为脱敏的 `SERVICE_NOT_READY` 或 `INTERNAL_ERROR`，不返回 `AgentClientError` 文本或堆栈。
- **理由**：公开最小接口与内部 run 语义完全一致，复制 DTO 会产生漂移。稳定错误足够驱动前端通用失败态，而不需要新增浏览器专属错误模型。
- **备选**：新增公开 Conversation DTO（当前没有额外业务字段，只有重复）；透传所有上游异常（可能泄露内部地址或实现信息）。

### D3: SSE 代理使用请求生命周期 AbortSignal，首版不做续接

- **做法**：API 在浏览器连接关闭时中止 `streamEvents()` 的上游 fetch；上游生成器结束后关闭下游响应。收到 `run.completed`、`run.failed` 或 `run.aborted` 后自然结束。首版公开路由不接收 `after`/`Last-Event-ID`，前端也不自动重连。
- **理由**：run 创建完成后，`insurance-agent` 的内存缓冲会从 cursor 1 重放，因此 POST 与后续 GET 之间不会丢失早期事件。自动重连需要定义重复增量去重、重试时限和刷新恢复，超出本 change。
- **备选**：直接用 Node 流无取消地管道转发（浏览器断开后会泄漏上游连接）；首版暴露 cursor 续接（增加前端状态机和验收面）。

### D4: API 使用非敏感环境配置，前端始终请求同源相对路径

- **做法**：API 默认监听 `127.0.0.1:4300`，默认 Agent 地址为 `http://127.0.0.1:4310`；支持环境变量覆盖 host、port、Agent base URL 及连接/响应超时，并在启动时严格校验。Vite dev server 将 `/api` 代理到本地 API，前端客户端只请求 `/api/chat/...`；生产环境由同源网关提供相同路径。
- **理由**：相对路径避免把内部服务地址或环境 URL打进浏览器代码，也减少开发 CORS 差异。配置不包含密钥，因此无需新增 secret 机制。
- **备选**：前端使用 `VITE_API_BASE_URL` 直连 API（引入跨域配置和环境泄漏面）；硬编码所有端口且不可覆盖（不利于测试和部署）。

### D5: Web API 客户端用 fetch 解析 POST 与 SSE

- **做法**：在 `apps/web/src/shared/api/` 实现小型 chat client：先 POST 创建 run，再用 `fetch` GET SSE，通过 `ReadableStream` 按空行切帧、解析 `data` JSON，并将 `AgentRunEvent` 交给 feature。客户端接受 `AbortSignal`，组件卸载时取消请求；流在未收到终态前结束视为失败。
- **理由**：原生 `EventSource` 不支持调用方 AbortSignal，且对非 2xx 响应、自动重连和错误体的控制较弱；fetch 能精确满足“首版不重连”和清理要求，且无需依赖。
- **备选**：`EventSource`（会默认重连且难区分错误）；引入 SSE 库（违反无新依赖和最小实现）。

### D6: 对话 feature 维护单一活动 run 和最小消息模型

- **做法**：把输入提交提升到 `ChatPanel`（或同级 feature 容器），维护当前页面消息数组、一个页面级 `sessionId`、一个活动 `runId`、发送状态与错误。ID 使用浏览器 `crypto.randomUUID()`；每次发送先保存 trim 后的原始文本、清空输入并追加用户消息。首个 `answer.delta` 创建助手消息，后续 delta 按 runId 追加到同一消息；终态恢复发送。组件卸载时 abort 网络订阅。
- **理由**：状态只被对话面板消费，放在 feature 内最符合“状态靠近使用者”；单活动 run 避免需要队列、事件归属竞争和多输入状态机。
- **备选**：全局状态库（项目禁止自行引入且没有跨 feature 需求）；每个 delta 作为一条消息（不符合流式回答语义）；把状态放进 `App.tsx`（让应用外壳承载业务流程）。

### D7: UI 只提供必要的可观察状态

- **做法**：保留静态欢迎消息；动态消息按用户/助手角色渲染并保留纯文本换行。活动 run 时禁用发送按钮但允许继续编辑输入；失败时在输入区附近使用 `role="alert"` 展示固定通用文案，流式助手内容使用可感知但不过度打断的 live region。创建失败前不生成空助手气泡，已收到增量后失败则保留部分回复。
- **理由**：满足发送、流式和失败验收，同时避免 Markdown、安全清洗、重试按钮或复杂状态徽标。
- **备选**：发送中禁用整个输入框（不必要地阻止用户准备下一条消息）；展示后端原始错误（泄露实现且文案不稳定）；失败时删除用户消息或部分回复（用户无法确认发生了什么）。

### D8: 自动化测试分层且不调用真实模型

- **做法**：
  - API 路由/启动测试注入 fake `AgentServiceClient` 或本地 fake Agent HTTP/SSE 服务，覆盖校验、202、错误映射、增量顺序、终态、断开清理。
  - Playwright 通过路由 mock `POST /api/chat/runs` 和 SSE 响应，覆盖用户消息、多个 delta 合并、发送禁用、完成恢复、创建失败和流中断；更新既有“发送不发网络请求”断言，但继续验证文件选择不上传。
  - 最终门禁执行 Web/API/insurance-agent 类型检查和测试、Web build、Playwright、格式、文档及 OpenSpec 校验。
- **理由**：端到端链路的自动化可以在无模型凭据下稳定验证；真实模型 smoke 只适合人工联调，不作为默认测试证据。
- **备选**：Playwright 启动真实 Agent 和模型（慢、收费、不稳定且需 secret）；只测纯函数（不能证明 HTTP/SSE 和用户行为）。

### 文档与运行说明同步

- 新增 `docs/features/agent-chat-streaming.md` 和 `docs/testing/connect-chat-agent-streaming.md`；更新 `docs/features/workbench-shell.md` 的静态边界。
- 更新 `docs/impl/pi-agent.md`、`docs/arch/system-design.md`，明确公开 API 已接通、当前临时 ID/无持久化/无鉴权边界；若架构图正文表达的运行状态发生变化，同步 `artifacts/architecture/` 图源与导出物。
- 更新 `apps/api/README.md`、`apps/web/README.md` 和根启动脚本说明，记录三个进程、环境配置、端口和最小联调步骤。
- 不新增或升级依赖，因此不新建 `docs/tech/` 文档；若实现发现必须改依赖，应先更新本 change 再实施。

## Risks / Trade-offs

- [公开 API 暂无鉴权，不能直接暴露到公网] → 默认仅监听 loopback，文档明确仅用于当前本地/受控联调；生产鉴权和防滥用由后续独立 change 设计。
- [页面刷新后消息与 run 关联全部丢失] → spec 明确临时生命周期；刷新不恢复，不把内存状态伪装成业务事实。
- [同一 `sessionId` 的多个 run 不共享 Pi 上下文] → 文档明确当前 Agent 每 run 独立；本 change 只验证传输链路，不宣称连续对话能力。
- [公开 SSE 首版不重连，短暂网络抖动会丢失后续回答] → 立即显示通用失败并恢复发送；cursor 续接与去重留给后续 change。
- [API 双层 SSE 转发可能受代理缓冲影响] → 设置 `text/event-stream`、`cache-control: no-cache` 和即时 flush 所需响应头；自动化验证增量分帧，部署时要求网关关闭该路径缓冲。
- [回答 delta 更新频繁导致 React 重渲染] → 首版直接按事件更新以保持代码最小；只有实际测量出现问题时再批处理，且不改变事件顺序。
- [旧 E2E 假设“发送无网络请求”会与新行为冲突] → 在本 change 中更新对应测试为“文件选择不上传”，并新增 API mock 的发送场景，其他静态回归继续保留。

## 实施状态与交接

- 已实现：`apps/api` 应用工厂/配置/公开对话路由与进程入口；`apps/web` 传输客户端、对话消息状态机、失败反馈与 Vite `/api` 代理；相关单测与 E2E（含真实 API 进程 + fake Agent 链路用例）；需求/测试/架构/对接/README 文档与架构图已同步。
- 受控真实模型联调（任务 5.3）：由项目负责人在本地人工执行并确认 `Web → API → insurance-agent → API SSE → Web` 完整链路可用；本次归档未落盘自动化采集的脱敏证据，缺口见 [测试计划的未覆盖项](../../../../docs/testing/connect-chat-agent-streaming.md)。
- 实施期内额外修复的既有缺陷：`apps/insurance-agent/test/config/agent-config.test.ts` 默认模型断言仍为 `deepseek-flash`，与仓库配置 `deepseek-v4.1-flash` 不一致，导致该包测试在本 change 之前即失败；按“配置为事实来源”更新断言，未改配置或运行时行为。

## Migration Plan

1. 先加入 API application factory、配置和公开路由，在 fake Agent 下验证，不改变 Web 行为。
2. 加入 Web chat client 与对话状态/UI，通过 Playwright mock 验证；Vite `/api` proxy 使本地请求保持同源。
3. 更新需求、测试、架构、对接和运行文档，执行完整门禁。
4. 受控联调时依次启动 `insurance-agent`、API、Web，使用非敏感测试消息验证多个 `answer.delta` 到达页面；不把回答正文写入测试证据。
5. 回滚时撤销 Web API 调用和 API 公开路由/启动入口即可；没有数据库迁移或持久状态需要回滚，`insurance-agent` 现有内部能力不受影响。
