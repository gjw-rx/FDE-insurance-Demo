> 说明：2.4 与 4.4 记录被明确延后的持久化工作（用户决定：先内存、后续换 DB）。这些任务已移交后续独立 change，不属本 change 的验收范围；原始需求文本保留在 `docs/features/chat-session-management.md`「后续范围」。

## 1. 契约与测试计划

- [x] 1.1 在 `@renewal/contracts` 增加 session 摘要、详情、消息、分页、创建和重命名契约及稳定错误码，并用 contracts/API 类型检查验证 Web 与 API 可从公开入口消费且无重复 DTO
  - 证据：`packages/contracts/src/chat/`、`packages/contracts/src/index.ts`、`apps/api/src/application/chat/`；`corepack pnpm typecheck` 全量通过（`.runtime/harness/1789807463386-8e983b4b/2.log`）
- [x] 1.2 按模板创建 `docs/features/chat-session-management.md`、更新 `docs/features/agent-chat-streaming.md` 与 `docs/features/workbench-shell.md`，并创建 `docs/testing/add-chat-session-management.md` 将 delta spec 的每个 scenario 映射到计划测试；运行 `corepack pnpm docs:check` 验证互链和必需章节
  - 证据：`docs:check` 通过（32 个 Markdown、1 个活动 change、16 个直接依赖，日志 `6.log`）

## 2. 会话存储与核心规则

- [x] 2.1 定义 session/message/run 记录、仓储接口和标题规范化规则，覆盖默认标题、Unicode 截断、手动标题优先、稳定消息顺序与非法数据的单元测试
  - 证据：`apps/api/test/application/chat/chat-session-title.test.ts`、`chat-session-store.test.ts`
- [x] 2.2 实现进程内会话仓储：会话与消息按 session 隔离、稳定排序、游标分页、run 幂等与终态收敛；用单元测试覆盖创建/更新、分页边界、缺失 session、重复 runId 与并发追加
  - 证据：`apps/api/src/infrastructure/persistence/in-memory-chat-session-store.ts`；API 测试 79 通过（`3.log`）
- [x] 2.3 在 API 组合根注入会话仓储与会话服务，并保证路由、应用服务与仓储都通过接口协作、可在测试中替换实现；通过 `@renewal/api` 生命周期与集成测试验证
  - 证据：`apps/api/src/bootstrap/application.ts`、`apps/api/test/bootstrap/lifecycle.test.ts`、`apps/api/test/interfaces/http/chat-session-routes.test.ts`
- [ ] 2.4 【已移交后续 change，不属本 change 验收范围】持久化会话存储与跨重启恢复：实现文件或数据库仓储、schema 版本、写入原子性与启动校验，使 API 重启后仍可列出并读取历史 session
  - 状态：未实现。按 2026-09-19 用户决定延后到后续独立 change，并由该 change 向 `chat-session-management` 主 spec ADD「会话跨服务重启持久保存」；`design.md`「已确认的延期范围」记录该决定与原因。

## 3. Session HTTP API

- [x] 3.1 实现 `POST /api/chat/sessions`、游标分页 `GET /api/chat/sessions`、`GET /api/chat/sessions/:sessionId` 与 `PATCH /api/chat/sessions/:sessionId`，覆盖成功、空列表、稳定排序/翻页、无效游标/标题、404、重命名失败和列表不含正文的 API 集成测试
  - 证据：`apps/api/src/interfaces/http/chat-session-routes.ts`、`apps/api/test/interfaces/http/chat-session-routes.test.ts`
- [x] 3.2 确认 session 路由错误响应和结构化日志只包含稳定错误码及非敏感 ID，不记录标题或消息正文；以日志捕获测试和 API 测试验证脱敏
  - 证据：`chat-session-routes.test.ts`「会话接口日志脱敏」、`chat-run-coordinator.test.ts`「日志脱敏」（断言标题与正文不出现在日志与错误响应中）

## 4. Agent run 编排

- [x] 4.1 重构 run 创建编排，校验 session、以 `runId` 幂等保存用户消息、在同一变更内完成首条消息自动命名，并在 Agent 拒绝时标记 `send-failed`；覆盖不存在 session、重复请求、失败保留和后续消息不改标题测试
  - 证据：`apps/api/src/application/chat/chat-session-service.ts`、`chat-run-coordinator.ts`；`chat-session-store.test.ts`、`chat-run-coordinator.test.ts`、`chat-routes.test.ts`
- [x] 4.2 实现 API 侧唯一 run coordinator，持续消费 Agent SSE、将增量收敛为助手消息、保存终态并向浏览器订阅者 fan-out；覆盖连续增量、唯一终态、浏览器断开后仍完成、多个订阅者和内部错误不落库测试
  - 证据：`chat-run-coordinator.test.ts`、`apps/api/test/interfaces/http/chat-routes.test.ts`（「浏览器断开后 API 继续消费并把完整回答保存下来」断言上游未被取消）
- [x] 4.3 实现 API 关闭时有界等待活动 run 消费并收敛未完成 run（进程内），通过生命周期集成测试证明不会永久停留在 `streaming` 且不会重复启动 run
  - 证据：`chat-run-coordinator.test.ts`「关闭后拒绝新 run 并收敛未完成的 run」（含 `shutdownTimeoutMs` 有界路径）；`createApiApp().close()` 先调和协调器再关服务
- [ ] 4.4 【已移交后续 change，不属本 change 验收范围】重启恢复规则：进程重启后把遗留 `streaming` 记录收敛为 interrupted，并证明重启不会重复启动 run
  - 状态：未实现。进程内存储重启即清空，该规则随 2.4 一并在后续持久化 change 落地。

## 5. Web 会话管理界面

- [x] 5.1 在 `shared/api` 增加 session create/list/detail/rename 客户端和错误处理，使用请求/响应测试覆盖分页、取消、404 与无效响应，不让 `shared` 反向依赖 feature
  - 证据：`apps/web/src/shared/api/chat-session-client.ts`、`apps/web/test/shared/api/chat-session-client.test.ts`（Web 测试 34 通过）
- [x] 5.2 在 `features/chat` 建立会话容器和导航组件，完成历史加载、空状态、失败与重试、显式新建、默认打开最近会话、详情切换及竞态取消；用纯逻辑单元测试与 E2E 验证旧响应不会覆盖新选择
  - 证据：`chat-workspace.tsx`（`detailSeqRef` 丢弃过期响应）、`chat-sessions.tsx`、`session-list.ts`；`session-state.test.ts`；E2E「会话列表加载失败」「切换历史会话…不混合两个会话的消息」
- [x] 5.3 实现首条消息后标题同步和会话重命名交互，覆盖空标题校验、成功更新、失败回滚、手动标题不被后续消息覆盖及可访问名称/键盘操作测试
  - 证据：`chat-workspace.tsx`（`syncSessionSummary`、`handleSubmitRename`）；E2E「首条消息自动命名并更新列表标题」「手动重命名…」「空标题被本地校验拒绝」「重命名失败…保留原标题」；`chat-session-store.test.ts`（服务端侧规则）
- [x] 5.4 将现有 `ChatPanel` 改为使用当前会话和恢复消息，活动 run 期间禁用发送/新建/切换，保留失败消息与增量；更新现有前端测试以验证刷新恢复和 session 间消息不混合
  - 证据：`chat-panel.tsx` 改为展示组件；`messages.ts` + `session-state.test.ts`；E2E 刷新恢复、切换不串台、创建失败保留用户消息
- [x] 5.5 添加 feature 局部样式并调整工作台组合，验证桌面与窄视口无横向滚动、历史区域与消息区可键盘访问；运行 `corepack pnpm verify:web` 并检查保存的构建、类型和相关测试日志
  - 证据：`apps/web/src/app/styles.css` 会话导航样式与 480px 断点；E2E 布局用例（1212×786、768×900 无横向滚动）与 480px 媒体查询；`verify:change` 中 web 类型检查、测试、构建与 Playwright 全绿

## 6. 端到端、文档与门禁

- [x] 6.1 扩展 Playwright 场景，验证新建两个 session、首条消息自动命名、切换恢复历史、手动重命名、刷新后恢复、活动 run 禁止切换及会话列表失败重试，测试使用 route mock 与 fake Agent
  - 证据：`tests/e2e/chat-api-mock.ts`、`agent-chat-streaming.spec.ts`（会话管理 11 个用例）、`chat-pipeline.spec.ts`（真实 API + fake Agent）；Playwright 42 通过（`5.log`）
- [x] 6.2 更新 `docs/impl/pi-agent.md` 的 session/run 消费说明，并按实际数据流更新 `docs/arch/system-design.md` 与关联 `artifacts/architecture/`；同步 `apps/api/README.md` 与 `apps/web/README.md` 的目录与接口说明，运行 `corepack pnpm docs:check`
  - 证据：`docs/impl/pi-agent.md`、`docs/arch/system-design.md`、两个 README；架构图重新 validate/deliver/visual-check 并更新哈希；`docs:check` 通过
- [x] 6.3 运行 `corepack pnpm verify:change add-chat-session-management`，将实际命令、日期、结果和 `.runtime/harness/` 证据路径写入 `docs/testing/add-chat-session-management.md`；仅在全部门禁通过后勾选完成项，并如实标注 2.4/4.4 未完成与不可归档原因
  - 证据：`verify:change` 8/8 PASS、`exitCode: 0`、`stale: false`（`.runtime/harness/1789807463386-8e983b4b/summary.json`）；测试计划已记录全部命令、日期、结果与人工截图抽查

## 7. 归档

- [x] 7.1 按已实现范围归档本 change（2026-09-19 用户确认）：从未满足的 delta 中移除「会话跨服务重启持久保存」，主 specs 只记录已实现行为，需求原文移交 `docs/features/chat-session-management.md`「后续范围」
  - 证据：主 spec 新增 `openspec/specs/chat-session-management/`（5 requirements）、更新 `agent-chat-streaming`（5 requirements）与 `workbench-shell`（无后端服务的静态展示）；归档目录 `openspec/changes/archive/2026-09-19-add-chat-session-management/`；2.4/4.4 保持未勾选并注明已移交后续 change

## 8. 界面按 pen 导出重构（2026-09-19 追加）

- [x] 8.1 从 `designs/insurance-assistant.html`（主壳与卡片）与 `designs/designs/dialog/export.png`（输入区）提取颜色、圆角、阴影、间距与字号，重写 `apps/web/src/app/styles.css` 并调整组件标记
  - 证据：`apps/web/src/app/styles.css`；截图核验 1212×786 与设计稿一致（会话栏、右列两卡片按 252:292 撑满、输入区 42px 主色按钮）
- [x] 8.2 会话导航改为设计稿的「会话栏 + 会话面板」：栏内展示当前标题与相对更新时间、右侧「新会话」按钮，列表收纳在 326×326 浮层并支持展开/收起、Escape、点击外部关闭
  - 证据：`apps/web/src/features/chat/chat-sessions.tsx`、`chat-workspace.tsx`、`session-list.ts`（`formatRelativeTime`）；`session-state.test.ts` 新增 7 个相对时间用例
- [x] 8.3 列表加载失败在会话栏直接可见（不只藏在未展开的面板内），满足「不把失败误呈现为空列表」与 workbench-shell「无后端」场景
  - 证据：`chat-sessions.tsx` 会话栏错误与重试；E2E「会话列表加载失败：显示失败与重试，重试成功后展示历史」；`front-init.spec.ts`「无后端环境打开页面」
- [x] 8.4 同步 delta spec 与本 change 设计：`chat-session-management`「查看历史会话列表」新增展开/收起与失败可见性要求，创建与重命名场景改用会话栏入口与「新会话」文案；`workbench-shell` 失败状态限定为会话栏；`design.md` 新增 D9
  - 证据：`specs/chat-session-management/spec.md`、`specs/workbench-shell/spec.md`、`design.md`；`openspec validate add-chat-session-management --strict` 通过
- [x] 8.5 更新 E2E：会话面板展开、会话栏标题断言、主色按钮精确名称匹配；输入区底部间距断言按设计稿 20px 内边距调整容忍度
  - 证据：`tests/e2e/agent-chat-streaming.spec.ts`、`dialog-function.spec.ts`、`chat-pipeline.spec.ts`；Playwright 42 通过
- [x] 8.6 修复会话条目固定高度导致的裁切缺陷：重命名表单撑出 42px 条目后被面板 `overflow: hidden` 裁掉「保存/取消」，用户看不到确认按钮
  - 原因：设计稿条目高度 42px 被写成固定 `height`（应为 `min-height`），同组 `align-items: stretch` 下的对齐也需同步调整
  - 修复：`.chat-session-item` 改 `min-height: 42px`；`.chat-session-item__rename` 加 `align-self: center`；去掉 `.chat-session-item__select` 的百分比高度；`.brand-bar` 同步改 `min-height` 以免窄视口换行被裁
  - 回归：E2E「手动重命名」新增断言——保存/取消按钮的布局盒必须落在会话面板边界内（`toBeVisible()` 对被裁切元素仍报可见，拦不住该类缺陷）
