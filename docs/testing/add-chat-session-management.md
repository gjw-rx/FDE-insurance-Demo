# add-chat-session-management 测试计划

> 状态：通过（自动门禁全部通过；「会话跨服务重启持久保存」为已确认延后项，见「未覆盖项」）

## 关联资料

- Change：[2026-09-19-add-chat-session-management](../../openspec/changes/archive/2026-09-19-add-chat-session-management/)
- 需求与 specs：[chat-session-management](../features/chat-session-management.md)、[agent-chat-streaming](../features/agent-chat-streaming.md)、[workbench-shell](../features/workbench-shell.md)
- Delta specs：[chat-session-management](../../openspec/changes/archive/2026-09-19-add-chat-session-management/specs/chat-session-management/spec.md)、[agent-chat-streaming](../../openspec/changes/archive/2026-09-19-add-chat-session-management/specs/agent-chat-streaming/spec.md)、[workbench-shell](../../openspec/changes/archive/2026-09-19-add-chat-session-management/specs/workbench-shell/spec.md)
- 设计：[change design](../../openspec/changes/archive/2026-09-19-add-chat-session-management/design.md)

## 测试范围

- 层次：
  - `apps/api` 单元/集成测试（Vitest）：标题规范化与提示词规则、进程内会话仓储、会话应用服务、run 协调器，以及 Fastify `inject` 与真实监听端口上的 HTTP/SSE 接口测试。
  - `packages/contracts` 编译期穷举表：新增 chat 契约后 `tsc --noEmit -p tsconfig.test.json` 必须通过。
  - `apps/web` 单元测试（Vitest）：会话传输客户端请求形状与错误映射、消息合并与列表合并纯逻辑。
  - Playwright E2E：route mock 覆盖会话与对话链路，另有真实 API 进程 + fake Agent + 独立 Vite 的链路用例。
- 前置条件：Node.js 24、pnpm 12、Vitest catalog 版本、Playwright 1.63。全部自动化不需要真实模型凭据，也不访问外部模型服务。
- 测试替身：
  - API 测试使用本地 fake insurance-agent HTTP/SSE 服务（Node `http` 临时监听），并按脚本推送事件；会话接口测试注入进程内仓储与替身 Agent。
  - Playwright 使用 `tests/e2e/chat-api-mock.ts`：在浏览器侧模拟会话 CRUD 与 run/SSE，替身内部保存会话状态，因此跨请求行为（自动命名、刷新恢复、切换会话）可被真实验证。
  - 「无后端」场景用 `offlineChatApi(page)` 显式让 `/api/**` 连接失败，不依赖开发机是否恰好监听默认端口。
- 测试数据均为非敏感合成文本；断言与日志不记录凭据，日志脱敏用例显式断言标题与消息正文不进入日志。

## 场景覆盖

| Requirement / Scenario                                 | 测试层次                  | 测试文件或用例                                                                                                                                                                                             | 状态   |
| ------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 创建独立聊天会话 / 成功新建会话                        | API 集成 + E2E            | `chat-session-routes.test.ts`（201 默认标题空会话）；`agent-chat-streaming.spec.ts`「新建会话：默认标题为「新会话」且没有历史消息」                                                                        | 通过   |
| 创建独立聊天会话 / 新建会话失败                        | E2E（route mock）         | `agent-chat-streaming.spec.ts` 通过会话列表错误路径覆盖提示与可用性（`failCreateSession` 场景见未覆盖项）                                                                                                  | 通过   |
| 创建独立聊天会话 / 活动 run 期间新建会话               | E2E（route mock）         | `agent-chat-streaming.spec.ts`「活动 run 期间禁止新建、切换与重命名会话」                                                                                                                                  | 通过   |
| 查看历史会话列表 / 加载历史会话                        | API 集成 + Web 单元 + E2E | `chat-session-routes.test.ts`（倒序列表）；`session-state.test.ts`（本地排序）；`agent-chat-streaming.spec.ts`「新建会话…」「首条消息自动命名并同步会话栏与会话列表」「刷新页面…」断言会话栏标题与面板条目 | 通过   |
| 查看历史会话列表 / 没有历史会话                        | API 集成 + E2E            | `chat-session-routes.test.ts`（空列表无游标）；`agent-chat-streaming.spec.ts`「首次打开没有历史会话」                                                                                                      | 通过   |
| 查看历史会话列表 / 加载更多历史会话                    | API 集成 + Web 单元       | `chat-session-routes.test.ts`「limit 与 cursor 支持翻页且不重复」；`session-state.test.ts`「分页追加不产生重复条目」                                                                                       | 通过   |
| 查看历史会话列表 / 展开与收起会话面板                  | E2E（route mock）         | `agent-chat-streaming.spec.ts`「新建会话…」（展开后可见条目）、「切换历史会话…」（选中后面板自动收起）                                                                                                     | 通过   |
| 查看历史会话列表 / 历史列表加载失败                    | E2E（route mock）         | `agent-chat-streaming.spec.ts`「会话列表加载失败：显示失败与重试，重试成功后展示历史」（会话栏可见失败与重试）                                                                                             | 通过   |
| 恢复历史会话内容 / 切换到历史会话                      | E2E（route mock）         | `agent-chat-streaming.spec.ts`「切换历史会话恢复已保存消息，且不混合两个会话的消息」                                                                                                                       | 通过   |
| 恢复历史会话内容 / 选择不存在的会话                    | API 集成 + Web 单元       | `chat-session-routes.test.ts`（404 稳定码）；`chat-session-client.test.ts`（404 → not-found）                                                                                                              | 通过   |
| 恢复历史会话内容 / 活动 run 期间切换会话               | E2E（route mock）         | `agent-chat-streaming.spec.ts`「活动 run 期间禁止新建、切换与重命名会话」                                                                                                                                  | 通过   |
| 首条消息自动生成会话标题 / 首条消息更新默认标题        | 应用服务 + E2E            | `chat-session-store.test.ts`「首条消息自动命名，后续消息不覆盖标题」；`agent-chat-streaming.spec.ts`「首条消息自动命名并更新列表标题」；`chat-pipeline.spec.ts`（真实 API 自动命名）                       | 通过   |
| 首条消息自动生成会话标题 / 后续消息不覆盖标题          | 应用服务                  | `chat-session-store.test.ts`（第二条消息不改标题）                                                                                                                                                         | 通过   |
| 首条消息自动生成会话标题 / 消息创建失败时不改标题      | 应用服务                  | `chat-session-store.test.ts`「Agent 拒绝创建时保留用户消息并标记发送失败」（未写入 runId 时不改标题）                                                                                                      | 通过   |
| 手动重命名会话 / 成功重命名                            | API 集成 + E2E            | `chat-session-routes.test.ts`「重命名成功后详情与列表一致更新」；`agent-chat-streaming.spec.ts`「手动重命名：列表标题更新且提交一次 PATCH」（同时断言会话栏标题同步）                                      | 通过   |
| 手动重命名会话 / 拒绝空标题                            | API 集成 + Web 单元 + E2E | `chat-session-routes.test.ts`「空标题返回 400 且保留原标题」；`session-state.test.ts`/`chat-session-client.test.ts`；`agent-chat-streaming.spec.ts`「空标题被本地校验拒绝且不提交请求」                    | 通过   |
| 手动重命名会话 / 重命名失败                            | E2E（route mock）         | `agent-chat-streaming.spec.ts`「重命名失败：显示通用提示并保留原标题」                                                                                                                                     | 通过   |
| 会话跨服务重启持久保存 / API 重启后恢复                | —                         | **本次未实现**：按用户决定会话仅存进程内，该场景由后续持久化 change 覆盖（见未覆盖项）                                                                                                                     | 未覆盖 |
| 会话跨服务重启持久保存 / 存储不可写                    | API 集成                  | `chat-session-routes.test.ts` 覆盖存储不可用错误码映射（`CHAT_SESSION_STORE_UNAVAILABLE` → 503 可重试）；进程内实现不会真正不可写                                                                          | 通过   |
| 业务 API 创建 Agent run / 成功创建 run                 | API 集成                  | `chat-routes.test.ts`「成功创建 run：返回 202 快照、消息只转发一次并已保存」                                                                                                                               | 通过   |
| 业务 API 创建 Agent run / 创建请求无效                 | API 集成                  | `chat-routes.test.ts`「空白/缺失/错误类型字段返回 400 且不调用 Agent」                                                                                                                                     | 通过   |
| 业务 API 创建 Agent run / session 不存在               | API 集成                  | `chat-routes.test.ts`「不存在的 session 返回 404 且不保存、不调用 Agent」                                                                                                                                  | 通过   |
| 业务 API 创建 Agent run / Agent 服务拒绝创建           | API 集成                  | `chat-routes.test.ts`「Agent 稳定服务错误保留错误码与 retryable，并标记用户消息发送失败」                                                                                                                  | 通过   |
| 业务 API 代理 Agent SSE 事件 / 流式返回回答            | API 集成                  | `chat-routes.test.ts`「按 cursor 顺序转发增量并以 run.completed 关闭，同时保存回答」                                                                                                                       | 通过   |
| 业务 API 代理 Agent SSE 事件 / Agent run 失败          | API 集成                  | `chat-routes.test.ts`「run.failed 且无增量时不创建空助手消息」「run.failed 有增量时助手消息保存为失败状态」                                                                                                | 通过   |
| 业务 API 代理 Agent SSE 事件 / 订阅不存在的 run        | API 集成                  | `chat-routes.test.ts`「订阅本进程未创建的 run 在流建立前返回 404」                                                                                                                                         | 通过   |
| 业务 API 代理 Agent SSE 事件 / 浏览器断开订阅          | API 集成 + 协调器         | `chat-routes.test.ts`「浏览器断开后 API 继续消费并把完整回答保存下来」；`chat-run-coordinator.test.ts`「浏览器断开订阅不影响服务端消费与保存」                                                             | 通过   |
| 前端发送并流式展示文本消息 / 首个增量                  | E2E（route mock）         | `agent-chat-streaming.spec.ts`「发送后输入清空、增量合并到同一助手消息、完成后恢复发送」                                                                                                                   | 通过   |
| 前端发送并流式展示文本消息 / 连续增量组成一条回复      | Web 单元 + E2E            | `session-state.test.ts`「首个增量创建助手消息，后续增量追加到同一条」；同名 E2E 用例                                                                                                                       | 通过   |
| 前端发送并流式展示文本消息 / run 正常完成              | E2E（route mock）         | 同名 E2E 用例（完整回复 + 发送恢复 + 无终态技术信息）                                                                                                                                                      | 通过   |
| 前端限制并发发送并反馈失败 / 活动 run 期间再次发送     | E2E（route mock）         | `agent-chat-streaming.spec.ts`「活动 run 期间发送按钮禁用，重复点击不产生第二个 POST」                                                                                                                     | 通过   |
| 前端限制并发发送并反馈失败 / 活动 run 期间管理 session | E2E（route mock）         | 「活动 run 期间禁止新建、切换与重命名会话」                                                                                                                                                                | 通过   |
| 前端限制并发发送并反馈失败 / 创建请求失败              | E2E（route mock）         | 「创建失败：显示通用错误、保留用户消息、不创建空助手消息」                                                                                                                                                 | 通过   |
| 前端限制并发发送并反馈失败 / SSE 中断或失败终止        | E2E（route mock）         | 「SSE 流提前中断」「run.failed 终态」「run.aborted 终态」                                                                                                                                                  | 通过   |
| 页面内临时关联标识 / 同一页面连续发送                  | E2E（route mock）         | 「发送后输入清空…」用例断言两次请求同 sessionId、不同 runId                                                                                                                                                | 通过   |
| 页面内临时关联标识 / 刷新页面                          | E2E（route mock）         | 「刷新页面：加载历史列表并默认打开最近更新的会话」                                                                                                                                                         | 通过   |
| 页面内临时关联标识 / 首次打开且没有历史会话            | E2E（route mock）         | 「首次打开没有历史会话：显示空状态并提供新建入口」                                                                                                                                                         | 通过   |
| 无后端服务的静态展示 / 无后端环境打开页面              | E2E（offline）            | `front-init.spec.ts`「无后端环境打开页面：区域完整展示，本地交互可用」（四个区域 + 会话区失败重试）                                                                                                        | 通过   |
| 无后端服务的静态展示 / 无后端环境发送文本              | E2E（route mock）         | `agent-chat-streaming.spec.ts`「无后端环境发送文本：通用失败提示，其他区域仍可用」                                                                                                                         | 通过   |
| 无后端服务的静态展示 / 会话列表失败后重试成功          | E2E（route mock）         | 「会话列表加载失败：显示失败与重试，重试成功后展示历史」                                                                                                                                                   | 通过   |
| （补充）会话条目重命名表单不被面板裁切                 | E2E（route mock）         | `agent-chat-streaming.spec.ts`「手动重命名…」断言保存/取消按钮落在 `.chat-session-panel` 边界内（`toBeVisible()` 对被 overflow 裁切的元素仍报可见，无法覆盖该类缺陷）                                      | 通过   |
| （补充）会话栏相对时间文案                             | Web 单元（Vitest）        | `session-state.test.ts`（`formatRelativeTime` 7 个用例，含非法时间戳与时钟偏差）                                                                                                                           | 通过   |
| （补充）API 关闭时有界等待并收敛未完成 run             | 协调器单元                | `chat-run-coordinator.test.ts`「关闭后拒绝新 run 并收敛未完成的 run」                                                                                                                                      | 通过   |
| （补充）run 幂等与保留期回收                           | 协调器单元                | `chat-run-coordinator.test.ts`（重复 runId、保留期过期、订阅未知 run）                                                                                                                                     | 通过   |
| （补充）日志与错误响应脱敏                             | API 集成 + 协调器         | `chat-session-routes.test.ts`「会话接口日志脱敏」；`chat-run-coordinator.test.ts`「日志脱敏」                                                                                                              | 通过   |
| （补充）端到端链路（浏览器 → 真实 API → fake Agent）   | E2E 集成                  | `chat-pipeline.spec.ts`（新建会话、自动命名、增量回传）                                                                                                                                                    | 通过   |

## 验证记录

| 日期       | 命令                                                                                              | 实际结果                                                                                                 | 证据                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2026-09-19 | `corepack pnpm verify:change add-chat-session-management`                                         | 通过；8/8 命令 PASS，`exitCode: 0`、`stale: false`                                                       | `.runtime/harness/1789807463386-8e983b4b/summary.json`                       |
| 2026-09-19 | ↳ `.agents/harness` 自测（同上批量）                                                              | 通过                                                                                                     | `.runtime/harness/1789807463386-8e983b4b/1.log`                              |
| 2026-09-19 | ↳ `corepack pnpm typecheck`                                                                       | 通过；contracts、web、api、insurance-agent 全部无类型错误                                                | `.runtime/harness/1789807463386-8e983b4b/2.log`                              |
| 2026-09-19 | ↳ `corepack pnpm test`                                                                            | 通过；web 34（3 文件）、api 79（8 文件）、insurance-agent 99（10 文件）                                  | `.runtime/harness/1789807463386-8e983b4b/3.log`                              |
| 2026-09-19 | ↳ `corepack pnpm --filter @renewal/web build`                                                     | 通过；`dist/assets/index-DOWZotlh.js` 246.23 kB / gzip 79.82 kB                                          | `.runtime/harness/1789807463386-8e983b4b/4.log`、`apps/web/dist/`            |
| 2026-09-19 | ↳ `corepack pnpm exec playwright test`                                                            | 通过；42 个用例，含会话管理 route mock、offline 无后端、以及真实 API + fake Agent 链路用例               | `.runtime/harness/1789807463386-8e983b4b/5.log`、`tests/e2e/`                |
| 2026-09-19 | ↳ `corepack pnpm docs:check`                                                                      | 通过；32 个 Markdown、1 个活动 change、16 个直接依赖                                                     | `.runtime/harness/1789807463386-8e983b4b/6.log`                              |
| 2026-09-19 | ↳ `corepack pnpm format:check`                                                                    | 通过；Prettier 全绿                                                                                      | `.runtime/harness/1789807463386-8e983b4b/7.log`                              |
| 2026-09-19 | ↳ `openspec validate add-chat-session-management --strict`                                        | 通过                                                                                                     | `.runtime/harness/1789807463386-8e983b4b/8.log`                              |
| 2026-09-19 | `node ~/.agents/skills/archify/bin/archify.mjs validate architecture … --quality showcase --json` | 通过；9/9 检查、0 composition error、0 warning                                                           | `artifacts/architecture/system-architecture.architecture.json`               |
| 2026-09-19 | `node ~/.agents/skills/archify/bin/archify.mjs deliver architecture … system-architecture.html`   | 通过；specification SHA-256 `15578f59…75bdf3`（5596 B）、artifact SHA-256 `a23946e8…4d10fe6`（815759 B） | `artifacts/architecture/system-architecture.html`                            |
| 2026-09-19 | `node ~/.agents/skills/archify/bin/archify.mjs visual-check system-architecture.html --json`      | 通过；`status: pass`、containment pass，绑定的 artifact SHA-256 与交付物一致                             | `artifacts/architecture/system-architecture.visual-check.json`               |
| 2026-09-19 | 人工截图抽查（读取 1440×900 浅色截图）                                                            | 通过；无节点遮挡、无关系线穿越或标签裁切；底部两张卡片文案已反映「会话与消息由业务 API 持有」的当前事实  | `artifacts/architecture/system-architecture.visual-check.1440x900.light.png` |

| 2026-09-19 | 界面重构后复跑：`corepack pnpm verify:change add-chat-session-management` | 通过；8/8 命令 PASS，`exitCode: 0`、`stale: false` | `.runtime/harness/1789809151613-bf116c5b/summary.json` |
| 2026-09-19 | ↳ 同批 `corepack pnpm test` | 通过；web 41（3 文件，新增 7 个相对时间用例）、api 79（8 文件）、insurance-agent 99（10 文件） | `.runtime/harness/1789809151613-bf116c5b/3.log` |
| 2026-09-19 | ↳ 同批 `corepack pnpm --filter @renewal/web build` 与 `playwright test` | 通过；`index-DjeB9S0z.js` 250.14 kB / gzip 80.61 kB；Playwright 42 通过（含会话栏/面板交互） | `.runtime/harness/1789809151613-bf116c5b/4.log`、`5.log` |
| 2026-09-19 | 界面与设计稿比对（`playwright screenshot` 1212×786，含展开会话面板） | 通过；会话栏、右列两卡片按 252:292 撑满、输入区 42px 主色按钮与 `designs/insurance-assistant.html` 一致；未见拥挤或裁切 | `/tmp/ui-2.png`、`/tmp/ui-panel.png`（临时核验产物，未入库） |

## 未覆盖项

- **「会话跨服务重启持久保存」未实现**：按 2026-09-19 用户决定，本次会话仅保存在业务 API 进程内，`CHAT_SESSION_STORE_UNAVAILABLE` 与重启恢复规则留给后续持久化 change（tasks 2.4、4.4）。该 decision 记录在 change 的 `design.md`「已确认的延期范围」，未完成前本 change 不满足归档条件。
- **`创建独立聊天会话 / 新建会话失败` 未单独自动化**：`installChatApiMock` 提供了 `failCreateSession` 开关，但尚未落成独立用例；当前由列表失败用例覆盖「会话区域错误提示不阻塞其他区域」这一可观察行为。
- **主 spec 尚未生成**：`chat-session-management` 目前只存在于本 change 的 delta spec，归档后才会写入 `openspec/specs/`。
- 断线续接、跨标签页协同、删除/归档/搜索会话不在本 change 范围（见 change 非目标）。
