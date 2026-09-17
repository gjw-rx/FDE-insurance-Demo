## 1. 实现前文档与测试计划

- [x] 1.1 按 `.agents/templates/feature.md` 创建 `docs/features/insurance-agent-runtime.md`，记录独立 `insurance-agent` 进程、应用专属配置、只读 Pi 能力范围与非目标，并链接本 change、delta spec 和测试计划；验证：`corepack pnpm docs:check` 通过且所有链接存在。
- [x] 1.2 按 `.agents/templates/testing.md` 创建 `docs/testing/integrate-insurance-agent-runtime.md`，逐一映射 delta spec 中的 requirement/scenario 到配置单测、SDK runtime 集成测试、HTTP/SSE 测试和 API client 契约测试，标记为“待实现”，并声明 fake provider、临时 HOME/runtime data/working directory 等前置条件；验证：场景表无遗漏且 `corepack pnpm docs:check` 通过。

## 2. Workspace、配置与共享契约

- [x] 2.1 创建 `apps/insurance-agent` workspace 骨架（`package.json`、`tsconfig.json`、`README.md`、`src/bootstrap`、`src/config`、`src/runtime`、`src/interfaces/http`），直接依赖锁定的 `@earendil-works/pi-coding-agent@0.85.1`、`fastify@5.12.4` 和 `@renewal/contracts`；将 SDK 运行依赖从 `apps/api` 移到新组合根并更新 lockfile；验证：`corepack pnpm install --lockfile-only` 成功，`corepack pnpm list --recursive --depth -1` 出现 `@renewal/insurance-agent`，且仅新服务直接依赖 Pi SDK。
- [x] 2.2 新增 `config/insurance-agent.json`，写入 `agent.name=insurance-agent`、`opencode-go/deepseek-flash`、`thinkingLevel=high`、只读工具 allowlist、runtime/resource/http 默认值；把 `.runtime/insurance-agent` 加入 `.gitignore`，不得写入凭据；验证：配置文件内容与 design D2 一致，secret 扫描/测试未发现明文 key 或 token，`rtk git diff --check` 通过。
- [x] 2.3 实现严格配置加载与校验：支持 `INSURANCE_AGENT_CONFIG_PATH`、确定性相对路径解析、字段白名单、数值/枚举/工具集合校验、明文 secret 字段拒绝和脱敏错误；验证：配置测试覆盖默认配置、非法字段、非法工具、路径解析、明文凭据与错误脱敏，`corepack pnpm --filter @renewal/insurance-agent test -- config` 通过。
- [x] 2.4 在 `packages/contracts/src/agent/` 定义 run 创建/停止 DTO、run 状态、健康/readiness、稳定错误码和脱敏 SSE 事件判别联合类型，并导出公共入口；验证：contracts 类型检查通过，类型测试或编译 fixture 能穷举所有终态和事件类型。

## 3. Pi SDK runtime 与安全边界

- [x] 3.1 实现应用专属 `ModelRuntime` 初始化：显式使用 `<dataDirectory>/auth.json`、`models.json`、`models-store.json`，从配置指定环境变量注入 runtime credential，执行有超时的 catalog 刷新，并严格解析配置模型且禁止 fallback；验证：fake catalog 测试覆盖成功、刷新超时/失败、模型不存在、凭据缺失和污染 `~/.pi/agent` 不影响有效模型。
- [x] 3.2 实现受控 SDK resource loader：使用专属 agentDir、`SettingsManager.inMemory()` 和配置 allowlist 加载 skills/context/服务内置 inline extensions，禁止用户 HOME、项目 `.pi/settings.json`、第三方 extension/package 的 ambient discovery；验证：fixture skill/context 可由 SDK 加载，污染 HOME 中的 skill/extension/settings 不会进入 runtime，资源 diagnostics 会影响 readiness。
- [x] 3.3 实现只读工具装配和路径门禁 inline extension：活动工具严格为 `read`、`grep`、`find`、`ls`，拒绝 `bash`、`edit`、`write` 及未知工具，并对路径做 canonicalize/realpath 校验以阻止绝对路径、`..` 和 symlink 逃逸；验证：SDK runtime 测试断言精确工具集合，允许工作目录内读取，拒绝三类逃逸且不返回文件正文、不产生写入或 shell 副作用。
- [x] 3.4 实现每 run 独立的 `AgentSessionRuntime` factory，以受控 cwd 和内存 `SessionManager` 创建 session、固定模型/thinking level、订阅事件、执行 `prompt()`，并在完成/失败/abort 后解除订阅和 dispose；验证：fake streaming provider 测试证明无需 Pi CLI 进程或开发会话即可完成 agent loop，两个 run 的 message/session 不串联，所有结束路径均释放资源。
- [x] 3.5 实现 run registry、并发 semaphore、deadline 和幂等终态收敛：同一 `runId` 不重复启动，达到上限返回可重试错误，abort/timeout/正常完成/provider error 竞争时只记录一个终态；验证：使用可控时钟和阻塞 fake provider 覆盖 duplicate、容量、timeout、abort 与竞态测试。

## 4. 事件映射与内部 HTTP/SSE

- [x] 4.1 实现 `RunEventMapper`，把 `session.subscribe()` 与 inline extension hooks 映射为 contracts 稳定事件，分配单调 cursor，丢弃 thinking、prompt、文件正文、tool args/result 和 credential，并用有界 ring buffer 保存 replay；验证：事件映射测试覆盖 agent/turn/message/tool/retry/compaction/settled、严格 cursor 顺序、无重复终态及敏感 canary 字符串不出现在事件或普通日志中。
- [x] 4.2 实现有上限的 event retention 与 subscriber queue：按 `maxEventsPerRun`、`eventRetentionMs` 清理，慢消费者超限断开；验证：可控时钟测试覆盖终态清理、过期 run、cursor 过旧和慢消费者，不出现无界数组或未释放 listener。
- [x] 4.3 实现 `GET /health/live`、`GET /health/ready`、`POST /internal/agent/runs`、`GET /internal/agent/runs/:runId/events` 和 `POST /internal/agent/runs/:runId/abort`，校验输入长度/格式并返回稳定状态码与错误码；验证：Fastify 集成测试覆盖 ready/not-ready、202 创建、重复 run、容量、404、幂等停止和脱敏错误。
- [x] 4.4 实现 SSE replay + live stream，支持 `after` 和 `Last-Event-ID`，从下一 cursor 续接；连接断开仅释放 subscriber，不停止 run；验证：真实 HTTP 监听测试覆盖首次订阅、断线重连无重复、`EVENT_CURSOR_EXPIRED`、`RUN_NOT_FOUND`、终态关闭和 client disconnect 后 run 继续。
- [x] 4.5 在 `apps/api/src/infrastructure/agent/` 实现基于 `@renewal/contracts` 的 typed client，配置 Agent 服务地址、连接/响应超时和错误映射，但不新增面向浏览器路由；验证：client contract 测试对 fake Agent 服务完成 create/events/abort，并覆盖连接失败、超时和服务错误映射。

## 5. 进程启动、回归与部署验证

- [x] 5.1 实现 `insurance-agent` 启动/关闭装配：启动前校验配置并初始化 model/resources readiness，绑定配置 host/port，处理 SIGTERM/SIGINT 时停止接收新 run、abort 活动 run 并关闭 Fastify/runtime；验证：子进程测试在独立 HOME 中启动后 liveness/Agent 名称正确，模型不可用时 readiness 为 not-ready，发送终止信号后进程在时限内退出且无残留 listener。
- [x] 5.2 在 `apps/insurance-agent/package.json` 和根工作区添加最小 dev/start/typecheck/test 命令，并提供一个需要显式 `INSURANCE_AGENT_API_KEY` 的受控 smoke 入口（默认 CI 不运行、不输出 prompt/answer 正文）；验证：`corepack pnpm --filter @renewal/insurance-agent typecheck`、`corepack pnpm --filter @renewal/insurance-agent test`、`corepack pnpm --filter @renewal/api typecheck` 全部通过。
- [x] 5.3 运行最小充分回归，确认静态 Web 与既有 workspace 不因新增服务改变：执行全 workspace 类型检查/测试命令、`corepack pnpm exec playwright test`（若既有门禁要求）和 `corepack pnpm format:check`；验证：所有实际执行命令通过，任何未执行项不得记录为通过。

## 6. 架构、技术与对接文档同步

- [x] 6.1 更新 `docs/impl/pi-agent.md`，记录独立服务拓扑、应用配置与 secret、内部 HTTP/SSE 字段映射、稳定错误、catalog/readiness、超时/停止/幂等、事件脱敏、fake 与受控 smoke 联调；验证：内容与实现和 contracts 一致，且文档无真实凭据。
- [x] 6.2 更新 `docs/tech/pi-sdk.md`，保持实际版本 `0.85.1`，补充 `apps/insurance-agent` 使用位置、`ModelRuntime`/`AgentSessionRuntime`/resource loader/只读 tools/hooks 的实际配置和验证方式，并明确 MCP、sub-agent 等不是本 change 使用的 SDK 原生能力；验证：`tech-packages` 覆盖实际直接依赖且 `corepack pnpm docs:check` 通过。
- [x] 6.3 更新 `docs/arch/system-design.md`、`apps/api/README.md` 并新增/完善 `apps/insurance-agent/README.md`，明确 `apps/api -> insurance-agent` 跨进程 HTTP/SSE 边界、业务 ID 与 Pi session 分离、只读工具和无业务状态边界；验证：正文、目录树和实际代码一致。
- [x] 6.4 使用 Archify 更新 `artifacts/architecture/` 图源、HTML/导出物和视觉验证证据，将 Pi Agent Runtime 标为独立服务进程并画出业务 API 的 HTTP/SSE 调用；验证：Archify 结构/组合检查通过、支持的基准视口无溢出，且人工抽查浅色/深色关键截图后在测试计划记录证据。

## 7. 最终验证与证据

- [x] 7.1 运行 `openspec validate integrate-insurance-agent-runtime --strict`、`corepack pnpm docs:check`、`corepack pnpm format:check` 以及 `docs/testing/integrate-insurance-agent-runtime.md` 列出的全部自动化命令；验证：命令均在本次实现中真实通过，无跳过的 requirement/scenario。
- [x] 7.2 更新 `docs/testing/integrate-insurance-agent-runtime.md`：填写执行日期、实际命令、结果、证据路径、未覆盖项和受控真实模型 smoke 是否执行；只有真实通过的项改为“通过”，并在本 tasks 文件逐项勾选对应已验证任务；验证：测试计划与实际输出一致，`corepack pnpm docs:check` 再次通过。
