## Context

现有实现以模块级 `crypto.randomUUID()` 生成页面临时 `sessionId`，`ChatPanel` 独自保存消息和活动 run；`apps/api` 仅代理 `POST /api/chat/runs` 与 SSE，不保存 session 或消息。`insurance-agent` 的 run registry 是有界内存状态，每个 run 建立独立 Pi `AgentSession`，因此不能作为业务历史来源。参见 [proposal.md](./proposal.md) 和本 change 的两份 delta spec。

本变更横跨 contracts、Fastify API、React chat feature 和 E2E，并引入持久数据模型。当前没有登录鉴权，用户已确认采用单个部署实例全局共享会话历史；这是一项明确的产品限制，而不是伪造的用户隔离。

## Goals / Non-Goals

**Goals:**

- 以项目自有 `sessionId` 建立可跨 API 重启恢复的会话、消息和 run 关联。
- 提供小而稳定的 session HTTP 契约，支持创建、游标列表、详情和重命名。
- 保留现有 Agent SSE 增量体验，同时确保浏览器断开后服务端仍能收敛并持久化终态。
- 将会话状态提升到 chat feature 的容器层，避免业务状态进入 `App.tsx` 或 `shared/ui`。
- 在不引入身份系统的前提下清楚约束单实例、全局可见和隐私边界。

**Non-Goals:**

- 不恢复 Pi 内部 session 上下文；历史消息可查看，但本 change 不把完整历史重新注入后续 Pi run。
- 不支持多 API 实例并发写、分布式锁、跨设备用户隔离、删除/归档/搜索会话。
- 不恢复刷新时仍在执行的浏览器 SSE；服务端会完成持久化，页面重新加载后读取最终已保存状态。
- 不使用模型生成标题，不引入新的第三方 SaaS 或真实用户鉴权。

## Decisions

### D1. 在业务 API 内建立 session 应用服务与仓储边界

新增 session 应用服务，HTTP 路由只负责协议校验与错误映射；应用服务编排 session、message、run 记录和 Agent client。仓储通过接口注入，测试使用内存替身，生产使用文件型持久化实现。

选择该方式而非把逻辑继续堆入 `chat-routes.ts`，因为创建 run 现在涉及“校验 session → 幂等保存用户消息 → 启动并消费 Agent run → 保存回答/终态”的一致性边界。它也符合 API 可依赖 application/domain、Web 仅依赖 contracts 的现有方向。

### D2. 首版使用 API 本地 JSON 快照文件，原子替换写入

在不新增运行时依赖的前提下，生产仓储将版本化数据快照保存在可配置路径（建议 `.runtime/api/chat-sessions.json`），每次变更先写同目录临时文件、`fsync` 后原子 rename。API 进程内使用串行写队列，避免同一进程并发覆盖；启动时校验 schema 版本和引用完整性，损坏时 not-ready/拒绝写入，不回退内存。

备选方案：

- SQLite：查询与事务能力更好，但会引入直接依赖、native/WASM 运行差异和对应技术文档；当前数据量与单实例边界不足以证明依赖成本。
- 浏览器 `localStorage`：无法满足服务端跨浏览器历史、Agent 终态持久化和部署实例统一事实来源。
- 纯内存：不满足跨 API 重启恢复。

该方案明确只支持一个 API 写进程。未来需要多实例或用户隔离时，以独立 change 迁移数据库。

### D3. 数据模型使用 session、message、run 三类稳定记录

- `ChatSessionRecord`：`id`、`title`、`titleSource`（`default | first-message | manual`）、`createdAt`、`updatedAt`。
- `ChatMessageRecord`：`id`、`sessionId`、`runId`、`role`、`text`、`status`（用户消息可为 `accepted | send-failed`，助手消息为 `streaming | completed | failed`）、`createdAt`、顺序号。
- `ChatRunRecord`：`runId`、`sessionId`、稳定状态、创建/更新时间；用于幂等和终态收敛。

列表只返回 session 摘要，不返回消息预览，避免敏感正文泄露。详情按稳定顺序返回消息；失败状态通过枚举表达，不写入内部错误正文。

### D4. session API 使用明确资源接口和游标分页

拟定公开接口：

| Method  | Path                                | 行为                                                     |
| ------- | ----------------------------------- | -------------------------------------------------------- |
| `POST`  | `/api/chat/sessions`                | 创建默认标题为空消息 session                             |
| `GET`   | `/api/chat/sessions?limit=&cursor=` | 按 `updatedAt DESC, sessionId DESC` 返回摘要与下一页游标 |
| `GET`   | `/api/chat/sessions/:sessionId`     | 返回摘要与有序持久消息                                   |
| `PATCH` | `/api/chat/sessions/:sessionId`     | 接收 `{ title }` 并返回更新摘要                          |

游标编码排序键并进行格式校验，默认和最大 page size 固定在 contracts/API。不存在返回 404 稳定错误；非法标题或游标返回 400。当前无鉴权，接口不接受伪造的 userId。

### D5. run 创建采用 runId 幂等记录，消息先持久化再调用 Agent

`POST /api/chat/runs` 先验证 session 存在，再以 `runId` 建立唯一记录并保存用户消息；重复相同 `runId` 返回既有结果而不重复消息或 Agent 调用。若 Agent 创建被拒绝，用户消息标记 `send-failed` 并返回现有稳定错误。首条消息自动命名与首次用户消息写入在同一仓储 mutation 内完成：仅当 `titleSource=default` 时，把消息折叠换行为空格、压缩连续空白并按 contracts 定义的最大 Unicode code point 数截断。

相比失败时删除消息，保留带失败状态的消息与现有 UI 语义一致，也避免用户输入悄然丢失。手动改名将 `titleSource` 设为 `manual`，后续消息永不覆盖。

### D6. 服务端拥有唯一 Agent 事件消费，浏览器订阅业务 API 的 fan-out

现有 HTTP handler 直接把浏览器断开信号传给 `insurance-agent` 上游；这会阻止服务端在无人订阅时保存终态。改为 API 内的 run coordinator 为每个 accepted run 建立唯一后台消费：累积 `answer.delta`、更新持久助手消息，并将稳定事件广播给当前浏览器订阅者。浏览器断开只移除 subscriber，不取消后台消费；终态后清理 coordinator。

API 正常关闭时停止接收新 run，等待有界时间让活动消费完成；超时则保留 `streaming` 状态。重启后首版不重新连接旧 run，读取详情时将遗留 `streaming` 映射为稳定的 `failed/interrupted` 状态，避免永久显示执行中。该恢复规则需有 API 测试。

### D7. Web 在 `features/chat` 内组合会话导航与对话面板

新增 chat feature 容器负责 session 列表、当前详情、活动 run 和错误状态；会话列表/重命名组件留在 `features/chat/`，HTTP 客户端放 `shared/api/`。`App.tsx` 仍只组合 feature 与续保侧栏。

初始化流程：加载首屏历史；有记录则打开最近更新 session，无记录则显示空状态，等待用户显式新建。切换详情时采用请求序号或 AbortController 防止旧响应覆盖新选择。活动 run 期间禁用新建和切换；重命名可选择同样禁用以减少状态竞争。响应式布局在窄视口将会话导航置于消息区上方/可折叠区域，不产生横向滚动。

### D8. 契约、错误与隐私边界

session DTO 全部定义在 `@renewal/contracts` 的公开 chat/session 模块，Web 不复制 API DTO。新增稳定错误至少覆盖 `CHAT_SESSION_NOT_FOUND`、`CHAT_SESSION_STORE_UNAVAILABLE`；输入错误继续使用 `INVALID_REQUEST`。API 日志只记录 sessionId/runId、操作和稳定错误码，不记录标题、消息正文或存储文件内容。

因为全局共享列表会暴露所有会话标题，本 change 的 UI/文档不得使用“我的会话”等暗示用户私有性的文案。生产部署若面向不互信用户，必须先完成鉴权 change。

## 已确认的延期范围

2026-09-20 实现评审中确认（用户决定）：

- 本次会话数据保存在业务 API 进程内（`InMemoryChatSessionStore`），不写文件、不接数据库；API 重启后历史清空。
- 仓储仍按 D1/D3 通过接口注入，后续换 DB 只替换实现，不改应用服务、路由和前端契约。
- delta spec「会话跨服务重启持久保存」因此持续未满足，本 change 不满足归档条件，必须与后续持久化 change 一起收尾；tasks.md 中 2.4/4.4 记录被延后的工作。
- D2（JSON 快照）、D6 的重启恢复部分、Migration Plan 第 1–5 步均未实施，保留为后续设计输入。

另：首屏新增历史会话请求后，API 不可用时该请求必然失败，与 `workbench-shell` 原文「页面初始状态不显示请求错误」互斥。本次按用户决定修改 `workbench-shell`「无后端服务的静态展示」：失败状态限定在会话区域内，四个区域、欢迎消息和本地交互不受影响。

### D9. 界面按 pen 导出原型重构

工作台视觉以仓库内的 pen 导出为准：主壳与卡片几何取自 `designs/insurance-assistant.html`（1212×786 原型，含 `designs/insurance-assistant.png` 渲染图），对话输入区取自 `designs/designs/dialog/export.png`。

关键取值直接读自原型而非凭观感猜测：栏高 76px、对话区左右列 684/348 与 17px 间距、卡片圆角 5px、面板圆角 4px、气泡底 `#FBFBFD`、主色 `#356DF3`、卡片阴影 `0 3px 12px #29304A12`，以及保司行高 48px、行间距 12px、无分割线。

会话导航按原型实现为「会话栏 + 会话面板」：栏内展示当前会话标题与相对更新时间并在右侧提供「新会话」；列表收纳在 326×326 的浮层面板中，支持展开/收起、Escape 与点击外部关闭。

与原型的两处有意差异：

- 不实现面板内的「搜索会话」输入框，会话搜索属于本需求非目标。
- 不渲染原型中与会话列表图标功能重叠的「最近会话」按钮，并在会话条目上补充重命名入口（原型未包含该操作，但重命名是已确认需求）。

右列两张卡片按原型高度比（252:292）分摊可用高度，使右列与对话区底部对齐且不留空白；同时在 ≤1024px 退化为单列、≤480px 收紧会话栏。

pen 导出的 HTML 属于生成产物，必须与导出保持一致，因此在 `.prettierignore` 中排除 `designs/**/*.html`（与既有 `artifacts/architecture/*.html` 同一处理方式）。

## Risks / Trade-offs

- [JSON 快照随消息量增长导致写放大] → 本次不实施（见「已确认的延期范围」），改由后续持久化 change 承担；内存实现在进程内无写放大风险。
- [进程重启丢失全部会话] → 已接受的临时限制；用户决定先实现内存版，仓储接口保证后续可替换为 DB。
- [Agent 接受与业务落库无法形成跨服务事务] → 先落库并以 runId 幂等；Agent 拒绝时保存 send-failed，重复请求不重复启动。
- [API 在 Agent 完成前崩溃] → 本次不承诺跨重启续接；进程内实现会在关闭时有界等待活动消费，未收敛的记录在本次不跨重启保留。跨重启收敛规则（遗留 `streaming` → interrupted）留给后续持久化 change。
- [无鉴权导致隐私隔离缺失] → 明示全局共享，列表不含正文，日志脱敏；不适用于多租户生产。
- [长消息被用于标题造成敏感信息暴露] → 标题严格截断、换行归一化且不进入日志；用户可立即重命名。真正的用户隔离留待鉴权 change。
- [切换请求竞态显示错误消息] → 取消旧详情请求并用当前 sessionId 校验响应后再提交状态。

## Migration Plan

1. 增加 contracts 与仓储 schema/version，默认数据文件不存在时初始化空快照；不迁移当前浏览器临时会话，因为它们从未持久化。
2. 先部署 API 的 session 接口、仓储和 run coordinator，并保留现有 run 请求形状；随后部署依赖新接口的 Web。
3. 部署验证创建、首条消息命名、重启恢复、重命名和历史详情，再开放入口。
4. 回滚 Web 可恢复旧界面，但新版 API 已保存的数据保持原文件不删除；回滚 API 前备份数据文件。旧 API 无法读取新历史，但不会修改该文件。
5. 若数据 schema 后续变化，必须通过显式版本迁移完成，不允许启动时静默丢弃未知字段或清空数据。

## Documentation and Verification

- 新建 `docs/features/chat-session-management.md`，更新 `docs/features/agent-chat-streaming.md` 与 `docs/features/workbench-shell.md`。
- 新建 `docs/testing/add-chat-session-management.md`，映射每个 scenario 到 API、Web 或 E2E 测试，并在实现后记录 `.runtime/harness/` 证据。
- 更新 `docs/impl/pi-agent.md` 的业务 session 与 run 消费说明；若公开接口/数据流改变架构表达，同步 `docs/arch/system-design.md` 及相关图源。
- 本次不新增 npm 依赖，也不改变运行配置项，因此 `docs/tech/` 无需新增文档；JSON/数据库存储方案的路径、单实例约束与验证方式由后续持久化 change 记录。
- 最终门禁使用 `corepack pnpm verify:change`；实现阶段分别通过 contracts/API 测试、Web 类型检查与构建、Playwright 关键流程和 `docs:check`。
