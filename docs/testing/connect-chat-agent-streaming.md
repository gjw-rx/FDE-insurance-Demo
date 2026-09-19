# connect-chat-agent-streaming 测试计划

> 状态：自动化通过；受控真实模型联调由项目负责人在本地人工验证通过（未落盘自动化脱敏证据）

## 关联资料

- Change：[connect-chat-agent-streaming](../../openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/)
- 需求与 specs：[agent-chat-streaming](../features/agent-chat-streaming.md)、[workbench-shell](../features/workbench-shell.md)
- Delta specs：[agent-chat-streaming](../../openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/specs/agent-chat-streaming/spec.md)、[workbench-shell](../../openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/specs/workbench-shell/spec.md)
- 设计：[change design](../../openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/design.md)

## 测试范围

- 层次：`apps/api` 单元/集成测试（Vitest，Fastify application factory + 真实本地监听端口）；`apps/web` 传输客户端单元测试（Vitest，注入 fetch 替身）；Playwright E2E（route mock、无 API 环境、以及真实 API 进程 + fake Agent + 独立 Vite 的链路用例）。
- 前置条件：Node.js 24、pnpm 12、Vitest catalog 版本、Playwright 1.63。全部自动化不需要真实模型凭据、不需要开发机 Pi 配置、不访问外部模型服务。
- 测试替身：
  - `apps/api` 集成测试使用本地 fake Agent HTTP/SSE 服务（Node `http` 临时监听），脚本化响应 202/快照、SSE 增量、终态与错误码；连接失败用关闭后的端口模拟，非法上游契约用非 JSON 响应模拟。
  - Playwright mock 层通过 `page.route` 拦截 `POST /api/chat/runs` 与 `GET /api/chat/runs/:runId/events`；「活动 run」场景用挂起 route handler 保持流 pending。
  - 链路用例 `tests/e2e/chat-pipeline.spec.ts` 在测试进程内启动 fake Agent、`tsx` 运行的真实 API 进程与独立 Vite dev server（`API_PROXY_TARGET` 指向测试 API），浏览器从真实页面发送消息。
- 测试数据均为非敏感合成文本；测试日志、断言与证据不记录 prompt 或回答正文，链路用例只断言消息长度与事件类型。

## 场景覆盖

| Requirement / Scenario                             | 测试层次                 | 测试文件或用例                                                                                      | 状态 |
| -------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- | ---- |
| 业务 API 创建 Agent run / 成功创建 run             | API 集成（fake Agent）   | `apps/api/test/interfaces/http/chat-routes.test.ts`：POST 202、字段回显、消息只转发一次             | 通过 |
| 业务 API 创建 Agent run / 创建请求无效             | API 集成                 | 同上：空白/缺失/错误类型字段返回 400 INVALID_REQUEST，且未调用 fake Agent                           | 通过 |
| 业务 API 创建 Agent run / Agent 服务拒绝创建       | API 集成                 | 同上：capacity 错误保留稳定码与 retryable，连接失败映射为脱敏 SERVICE_NOT_READY                     | 通过 |
| 业务 API 代理 Agent SSE 事件 / 流式返回回答        | API 集成（真实端口）     | 同上：SSE 按 cursor 顺序转发增量并以 run.completed 关闭，响应头含 `no-cache`                        | 通过 |
| 业务 API 代理 Agent SSE 事件 / Agent run 失败      | API 集成                 | 同上：run.failed / run.aborted 唯一终态转发后关闭                                                   | 通过 |
| 业务 API 代理 Agent SSE 事件 / 订阅不存在的 run    | API 集成                 | 同上：上游 404 时在写出 SSE 头之前返回 RUN_NOT_FOUND JSON 错误                                      | 通过 |
| 业务 API 代理 Agent SSE 事件 / 浏览器断开订阅      | API 集成                 | 同上：客户端断开后上游连接被取消（fake Agent 观察到 close）                                         | 通过 |
| 前端发送并流式展示文本消息 / 首个增量              | Playwright（route mock） | `tests/e2e/agent-chat-streaming.spec.ts`：发送后输入清空、用户消息追加、助手消息出现                | 通过 |
| 前端发送并流式展示文本消息 / 连续增量组成一条回复  | Playwright（route mock） | 同上：多 delta 合并为单条助手消息（整体文本恰为三段拼接）                                           | 通过 |
| 前端发送并流式展示文本消息 / run 正常完成          | Playwright（route mock） | 同上：完整回复保留、发送恢复可用、无终态技术信息渲染                                                | 通过 |
| 前端限制并发发送并反馈失败 / 活动 run 期间再次发送 | Playwright（route mock） | 同上：挂起流期间发送按钮禁用，重复点击不产生第二个 POST                                             | 通过 |
| 前端限制并发发送并反馈失败 / 创建请求失败          | Playwright（route mock） | 同上：显示通用错误（`role="alert"`）、保留用户消息、不创建空助手消息、重新输入后可再次发送          | 通过 |
| 前端限制并发发送并反馈失败 / SSE 中断或失败终止    | Playwright（route mock） | 同上：流提前结束、run.failed、run.aborted 分别进入通用失败态并保留已收增量                          | 通过 |
| 页面内临时关联标识 / 同一页面连续发送              | Playwright（route mock） | 同上：两次请求 sessionId 相同、runId 不同                                                           | 通过 |
| 页面内临时关联标识 / 刷新页面                      | Playwright（route mock） | 同上：刷新后消息区回到欢迎消息，不恢复旧 run                                                        | 通过 |
| 对话输入区本地交互 / 空输入时发送不可用            | E2E 回归                 | `tests/e2e/dialog-function.spec.ts`（既有用例保留）                                                 | 通过 |
| 对话输入区本地交互 / 输入内容后发送并清空          | E2E 更新                 | `tests/e2e/dialog-function.spec.ts`：断言输入清空、用户消息追加（2 条消息）与一次 POST              | 通过 |
| 对话输入区本地交互 / 活动 run 期间发送不可用       | Playwright（route mock） | `tests/e2e/agent-chat-streaming.spec.ts`（与并发场景共用用例）与 `dialog-function.spec.ts`          | 通过 |
| 对话输入区本地交互 / 选择图片或 PDF 文件           | E2E 回归                 | `tests/e2e/dialog-function.spec.ts`（既有用例保留）                                                 | 通过 |
| 对话输入区本地交互 / 选择越界类型文件              | E2E 回归                 | `tests/e2e/dialog-function.spec.ts`（既有用例保留）                                                 | 通过 |
| 对话输入区本地交互 / 输入区不发起网络请求          | E2E 更新                 | `tests/e2e/dialog-function.spec.ts`：文本只发同源业务 API、文件选择无上传、无内部接口直连           | 通过 |
| 无后端服务的静态展示 / 无后端环境打开页面          | E2E 回归                 | `tests/e2e/front-init.spec.ts`（既有用例保留）                                                      | 通过 |
| 无后端服务的静态展示 / 无后端环境发送文本          | Playwright（无 API）     | `tests/e2e/agent-chat-streaming.spec.ts`：API 不可达时通用失败提示，报价/保司区域仍可用             | 通过 |
| （补充）Web 传输客户端 SSE 解析与失败映射          | Web 单元（Vitest）       | `apps/web/test/shared/api/chat-client.test.ts`：分块跨界、连续帧、非法 JSON、非 2xx、提前结束、取消 | 通过 |
| （补充）端到端链路（浏览器 → API → fake Agent）    | E2E 集成                 | `tests/e2e/chat-pipeline.spec.ts`：真实 API 进程 + fake Agent + 独立 Vite，验证消息与增量           | 通过 |

Web 传输客户端测试按计划把 Vitest 加入 `apps/web` devDependencies（workspace catalog 版本，不新增第三方来源）并同步了 `docs/tech/vitest.md` 的使用位置说明。

## 验证记录

| 日期       | 命令                                                                                                                                                                                                                                                | 实际结果                                                                                                                                                   | 证据                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 2026-09-17 | `corepack pnpm --filter @renewal/api test`                                                                                                                                                                                                          | 通过；4 个测试文件、24 个用例                                                                                                                              | `apps/api/test/`                                                                       |
| 2026-09-17 | `corepack pnpm --filter @renewal/web test`                                                                                                                                                                                                          | 通过；1 个测试文件、9 个用例                                                                                                                               | `apps/web/test/shared/api/chat-client.test.ts`                                         |
| 2026-09-17 | `corepack pnpm --filter @renewal/insurance-agent test`                                                                                                                                                                                              | 通过；10 个测试文件、99 个用例                                                                                                                             | `apps/insurance-agent/test/`                                                           |
| 2026-09-17 | `corepack pnpm typecheck`、`corepack pnpm exec tsc --noEmit -p apps/web`                                                                                                                                                                            | 通过；contracts、web、api、insurance-agent 类型检查全部完成                                                                                                | 命令输出                                                                               |
| 2026-09-17 | `corepack pnpm --filter @renewal/web build`                                                                                                                                                                                                         | 通过；生产构建产出 `dist/assets/index-*.js`（237.43 kB / gzip 77.44 kB）                                                                                   | `apps/web/dist/`                                                                       |
| 2026-09-17 | `corepack pnpm exec playwright test`                                                                                                                                                                                                                | 通过；29 个用例，含 route mock、无 API 环境与真实 API + fake Agent 链路用例                                                                                | `tests/e2e/`                                                                           |
| 2026-09-17 | `corepack pnpm format:check`、`corepack pnpm docs:check`                                                                                                                                                                                            | 通过；Prettier 全绿，28 个 Markdown、1 个活动 change、16 个直接依赖                                                                                        | 命令输出                                                                               |
| 2026-09-17 | `openspec validate connect-chat-agent-streaming --strict`                                                                                                                                                                                           | 通过                                                                                                                                                       | `openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/`                    |
| 2026-09-17 | Archify `validate`、`deliver`、`visual-check`（architecture / showcase）                                                                                                                                                                            | 通过；9/9 检查、0 error、0 warning；图源 SHA-256 `cddcdb2b…c305e2`、HTML SHA-256 `f18afaa4…eedb00`；1440×900 与 2048×1320 明暗四张截图均无溢出、可读性通过 | `artifacts/architecture/system-architecture.*`                                         |
| 2026-09-17 | 人工感知审阅：1440×900 浅色截图                                                                                                                                                                                                                     | 通过；Web → 业务 API 已为实线「对话 API 与 SSE 事件」，节点文案与三张卡片和实现一致，无遮挡/裁切                                                           | `artifacts/architecture/system-architecture.visual-check.1440x900.light.png`           |
| 2026-09-19 | 归档前复核：`corepack pnpm exec playwright test`、`corepack pnpm --filter @renewal/web test`、`corepack pnpm exec tsc --noEmit -p apps/web`、`corepack pnpm --filter @renewal/web build`、`corepack pnpm format:check`、`openspec validate --specs` | 通过；Playwright 33 通过（同批执行了 4 个未纳入本 change spec 的输入区键盘用例）、Web 单测 9 通过、类型检查与生产构建通过、格式检查通过、主 specs 3 passed | `tests/e2e/`、`apps/web/test/`                                                         |
| 2026-09-19 | 受控真实模型联调（项目负责人在本地人工执行）                                                                                                                                                                                                        | 通过；确认 `Web → API → insurance-agent → API SSE → Web` 完整链路可用                                                                                      | 无自动化脱敏证据落盘（未采集进程 ready / POST 202 / delta / 终态日志），缺口见未覆盖项 |

架构图证据绑定：图源 SHA-256 `cddcdb2b9cac52a863d472c18e4b19c1d668ce8bb49be4ebb785f55eefc305e2`（5480 字节），HTML SHA-256 `f18afaa4de9c74af8261962590305fde6995252158d68dd2f9d6967d9eeedb00`（815628 字节）。

## 未覆盖项

- **未落盘自动化脱敏证据**（change 任务 5.3）：受控真实模型联调已由项目负责人在本地人工执行并确认完整链路可用，但本次归档未采集与之对应的进程 ready、POST 202、按序 delta 与唯一完成终态的自动化脱敏证据，因此本计划不声称已具备该证据。补齐方式：提供凭据并启动 `corepack pnpm dev:insurance-agent` 后，按本计划重跑链路用例或受控联调脚本并保存脱敏记录。
- 说明（与实现相关的既有缺陷）：`apps/insurance-agent/test/config/agent-config.test.ts` 中的默认模型断言原先仍为 `deepseek-flash`，而仓库配置 `config/insurance-agent.json` 已是 `deepseek-v4.1-flash`，导致该包测试在本 change 之前即失败。本次按「配置为事实来源」更新该断言，未改动配置或运行时行为。
- SSE cursor 断线重连、并发多标签页、页面刷新恢复不在本 change 范围（见 change 非目标）。
- 公开对话路由当前无鉴权、无持久化、仅面向同源访问（开发经 Vite 代理、生产由网关提供）；生产化安全与持久化由后续 change 覆盖。
