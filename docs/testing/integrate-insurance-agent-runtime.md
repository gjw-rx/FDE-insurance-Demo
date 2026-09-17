# integrate-insurance-agent-runtime 测试计划

> 状态：已完成并归档（2026-09-17）

## 关联资料

- Change：[integrate-insurance-agent-runtime](../../openspec/changes/archive/2026-09-17-integrate-insurance-agent-runtime/)
- 需求与 specs：[insurance-agent-runtime 需求](../features/insurance-agent-runtime.md)、[delta spec](../../openspec/changes/archive/2026-09-17-integrate-insurance-agent-runtime/specs/insurance-agent-runtime/spec.md)
- 设计与对接：[change design](../../openspec/changes/archive/2026-09-17-integrate-insurance-agent-runtime/design.md)、[Pi Agent 对接设计](../impl/pi-agent.md)

## 测试范围

- 层次：`apps/insurance-agent` 单元测试（配置、事件映射、并发与终态）与进程内集成测试（Pi SDK runtime 装配、Fastify HTTP/SSE）；`apps/api` 对 Agent 服务的 typed client 契约测试。
- 前置条件：Node.js 24、pnpm 12、Vitest（catalog 版本）。所有自动化测试都不需要真实模型凭据、不需要开发机 Pi 配置、不需要交互式 Pi 进程。
- 测试替身：
  - 模型层使用 pi-ai 的 `fauxProvider()` 注册本地 streaming provider，通过 `setResponses()` 脚本化文本、工具调用、错误和阻塞；`ModelRuntime` 使用临时目录下的 `auth.json`、`models.json`、`models-store.json`。
  - 每个测试用例使用独立的临时目录作为 HOME、runtime data 和受控工作目录，并在污染 HOME 中放置伪 skill/extension/settings，用于断言隔离。
  - HTTP 层使用 Fastify `inject()` 以及真实监听端口的本地连接（SSE 断线重连场景）。
  - `apps/api` 契约测试使用最小 HTTP 服务或本地监听端口模拟 Agent 服务，覆盖连接失败与超时。
- 受控真实模型 smoke 不属于默认测试门禁，需要显式提供 `INSURANCE_AGENT_API_KEY`，且不得把 prompt 或回答正文写入证据。

## 场景覆盖

| Requirement / Scenario                               | 测试层次    | 测试文件或用例                                                                                                   | 状态 |
| ---------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | ---- |
| 独立的 insurance-agent 服务进程 / 独立启动服务       | 进程集成    | `apps/insurance-agent/test/bootstrap/lifecycle.test.ts`：启动子进程后 liveness 返回 `insurance-agent`            | 通过 |
| 独立的 insurance-agent 服务进程 / 当前 Pi 会话不存在 | 进程集成    | `lifecycle.test.ts` 与 `test/runtime/agent-session.test.ts`：隔离 HOME、无 Pi 进程或开发会话                     | 通过 |
| 应用专属配置与运行数据隔离 / 使用仓库默认配置启动    | 单元        | `apps/insurance-agent/test/config/agent-config.test.ts`：默认配置解析结果                                        | 通过 |
| 应用专属配置与运行数据隔离 / 开发机全局设置不同      | 单元 + 集成 | `agent-config.test.ts` 与 `test/runtime/agent-model-runtime.test.ts`：污染 HOME 不影响配置与模型                 | 通过 |
| 应用专属配置与运行数据隔离 / 配置包含明文凭据        | 单元        | `agent-config.test.ts`：明文 secret 字段被拒绝且错误不回显值                                                     | 通过 |
| 应用专属配置与运行数据隔离 / 必填配置无效            | 单元        | `agent-config.test.ts`：缺失/非法字段返回可定位错误                                                              | 通过 |
| 模型可用性必须显式验证 / 模型和凭据可用              | 集成        | `test/runtime/agent-model-runtime.test.ts`：faux provider 解析成功时 ready                                       | 通过 |
| 模型可用性必须显式验证 / 模型不可用                  | 集成        | `agent-model-runtime.test.ts`：刷新超时/失败、模型不存在、凭据缺失均 not-ready 且不换模型                        | 通过 |
| 仅启用 Pi SDK 原生只读能力 / runtime 能力装配        | 集成        | `test/runtime/agent-session.test.ts` 与 `agent-resources.test.ts`：活动工具恰好四个且 fixture skill 可加载       | 通过 |
| 仅启用 Pi SDK 原生只读能力 / 模型请求写入或执行命令  | 集成        | `agent-session.test.ts` 与 `path-guard.test.ts`：`bash`/`edit`/`write` 不可调用                                  | 通过 |
| 仅启用 Pi SDK 原生只读能力 / 读取受控工作目录外路径  | 集成        | `test/runtime/path-guard.test.ts`：绝对路径、`..`、symlink 逃逸被 block 且不返回内容                             | 通过 |
| run 创建与并发控制 / 成功创建 run                    | 集成        | `test/interfaces/http/server.test.ts`：202 快照字段与异步 loop                                                   | 通过 |
| run 创建与并发控制 / 重复提交相同 runId              | 集成        | `test/runtime/run-registry.test.ts`：第二次提交不触发 provider                                                   | 通过 |
| run 创建与并发控制 / 达到并发上限                    | 集成        | `run-registry.test.ts`：超出上限返回可重试容量错误                                                               | 通过 |
| 稳定且脱敏的流式事件 / 订阅活动 run                  | 集成        | `test/interfaces/http/sse.test.ts`：按 cursor 顺序收到生命周期与终态                                             | 通过 |
| 稳定且脱敏的流式事件 / 使用 cursor 重连              | 集成        | `sse.test.ts`：`after`/`Last-Event-ID` 从下一条续接且不重复                                                      | 通过 |
| 稳定且脱敏的流式事件 / Pi SDK 产生敏感事件字段       | 单元        | `test/runtime/run-event-projector.test.ts`：敏感字段不进入事件                                                   | 通过 |
| run 可停止且必须收敛到单一终态 / 停止活动 run        | 集成        | `test/runtime/run-registry.test.ts`：abort 仅产生一个终态并释放资源                                              | 通过 |
| run 可停止且必须收敛到单一终态 / 重复停止终态 run    | 集成        | `test/interfaces/http/server.test.ts`：幂等停止返回既有终态                                                      | 通过 |
| run 可停止且必须收敛到单一终态 / Agent 执行失败      | 集成        | `run-registry.test.ts`：provider 错误收敛为 failed 且信息脱敏                                                    | 通过 |
| 自动化验证不依赖真实模型和本机 Pi / 隔离环境执行测试 | 集成        | `apps/insurance-agent/test/` 使用临时 HOME 与 faux provider；`packages/contracts/test/` 编译穷举 fixture         | 通过 |
| （补充）业务 API typed client 契约                   | 契约        | `apps/api/test/infrastructure/agent/agent-service-client.test.ts`：create/events/abort、连接、超时与服务错误映射 | 通过 |

## 验证记录

| 日期       | 命令                                                                                                   | 实际结果                                                                                                                                                                                                                                                      | 证据                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-15 | `corepack pnpm typecheck`                                                                              | 通过；contracts、API、insurance-agent 类型检查完成                                                                                                                                                                                                            | 命令输出；`packages/contracts`、`apps/api`、`apps/insurance-agent`                                                         |
| 2026-09-15 | `corepack pnpm exec tsc --noEmit -p apps/web/tsconfig.json`                                            | 通过；`packages/application` 与 `packages/domain` 当前只有 `.gitkeep`，无 TypeScript 输入                                                                                                                                                                     | 命令输出；`apps/web/tsconfig.json`                                                                                         |
| 2026-09-15 | `corepack pnpm test`                                                                                   | 通过；insurance-agent 10 个文件、93 个用例，API 1 个文件、6 个用例，contracts 编译 fixture 通过                                                                                                                                                               | `apps/insurance-agent/test/`、`apps/api/test/`、`packages/contracts/test/`                                                 |
| 2026-09-15 | review 修复后复跑：全 workspace `typecheck`/`test`、`docs:check`、`format:check`                       | 通过；`apps/insurance-agent/tsconfig.json` 已纳入 `test`（测试代码由此进入类型检查门禁）；insurance-agent 99 个用例、api 7 个用例、contracts 编译 fixture 全部通过；112 个函数定义全部有注释                                                                  | `apps/insurance-agent/tsconfig.json`、`apps/insurance-agent/test/`、`apps/api/test/`、`docs/impl/pi-agent.md` 可观测性章节 |
| 2026-09-15 | `corepack pnpm --filter @renewal/web build`、`corepack pnpm exec playwright test`                      | 通过；Web 生产构建完成，20 个既有 E2E 用例通过                                                                                                                                                                                                                | `apps/web/dist/`、`tests/e2e/`                                                                                             |
| 2026-09-15 | `corepack pnpm docs:check`、`corepack pnpm format:check`、`git diff --check`                           | 通过；26 个 Markdown、1 个活动 change、16 个直接依赖，格式与空白检查通过                                                                                                                                                                                      | `docs/`、`openspec/changes/archive/2026-09-17-integrate-insurance-agent-runtime/`                                          |
| 2026-09-15 | `openspec validate integrate-insurance-agent-runtime --strict`                                         | 通过                                                                                                                                                                                                                                                          | `openspec/changes/archive/2026-09-17-integrate-insurance-agent-runtime/`                                                   |
| 2026-09-15 | Archify `validate`、`deliver`、`visual-check`（architecture / showcase）                               | 通过；9/9、0 error、0 warning，四个桌面视口无溢出；浅色/深色截图人工抽查通过                                                                                                                                                                                  | `artifacts/architecture/system-architecture.html`、`system-architecture.visual-check.json` 与 PNG                          |
| 2026-09-17 | 真实模型端到端验证：`/health/live`、`/health/ready`、创建 run、SSE 订阅、重复 runId 幂等、`after` 续接 | 通过；readiness 解析为 `opencode-go/deepseek-v4.1-flash`；SSE cursor 自 1 单调递增并以 `run.completed` 收束后自动关闭；重复 runId 返回同一快照（`createdAt` 一致）且不重复执行；`?after=N` 精确续接不重不漏；服务日志与证据均不含 prompt、thinking 与回答正文 | `config/insurance-agent.json`、进程 stdout 启动摘要                                                                        |

架构图证据绑定：图源 SHA-256 `b0ec4dc4b4431b6b538d1984305f94ea609af296f3d21e35032eafa333113966`，HTML SHA-256 `ed90be8e623bf3acd37cbd20d71fc48716e67e9e2a5423a9deeca7144159f16d`。人工视觉抽查覆盖 1440×900 与 2048×1320 的浅色/深色截图，未发现节点遮挡、关系线穿越、标签裁切或明显空白失衡。

## 未覆盖项

- 真实模型 provider 的端到端 smoke 默认不执行，仅作为受控部署验证项；需要显式提供 `INSURANCE_AGENT_API_KEY`。
- `corepack pnpm --filter @renewal/insurance-agent smoke` 仍作为受控部署验证项单独保留；本 change 已通过真实模型的端到端 HTTP/SSE 验证（见上表 2026-09-17 记录）。
- 服务重启后的 run 恢复不在本 change 范围（内存 registry 与 replay buffer 为单进程状态），由后续持久化 change 覆盖。
- 浏览器到业务 API 的完整对话交互不在本 change 范围，由定义消息产品行为的后续 change 覆盖。
