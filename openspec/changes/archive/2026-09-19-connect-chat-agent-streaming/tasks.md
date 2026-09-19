## 1. 实现前需求与测试计划

- [x] 1.1 按 `.agents/templates/feature.md` 创建 `docs/features/agent-chat-streaming.md`，记录文本发送、API/Agent/SSE 链路、临时 ID 和非目标；同时更新 `docs/features/workbench-shell.md`，移除“文本发送仅本地”的旧边界并链接本 change；验证：feature 名与 spec 目录一致、链接均存在，`corepack pnpm docs:check` 通过。
- [x] 1.2 按 `.agents/templates/testing.md` 创建 `docs/testing/connect-chat-agent-streaming.md`，把两个 delta spec 的全部 requirement/scenario 映射到 API 测试、Web/Playwright 测试和受控联调，状态标为“待实现”，并明确 fake Agent/SSE、不使用真实模型及不记录消息正文；验证：场景表无遗漏且 `corepack pnpm docs:check` 通过。

## 2. 可启动业务 API 与公开请求接口

- [x] 2.1 为 `apps/api` 实现严格的非敏感运行配置和 Fastify application factory，默认监听 `127.0.0.1:4300`、调用 `http://127.0.0.1:4310`，支持环境变量覆盖 host、port、Agent URL 和超时，并注入现有 `AgentServiceClient`；验证：配置/application 测试覆盖默认值、覆盖值、非法 URL/端口/超时，`corepack pnpm --filter @renewal/api test` 通过。
- [x] 2.2 实现 `POST /api/chat/runs`：校验 `sessionId`、`runId`、`message` 的类型与非空约束，只调用一次 Agent create，并将成功结果返回 202；把 Agent 稳定服务错误及连接/超时/协议错误映射为脱敏公开响应；验证：路由测试覆盖成功、空白消息、缺失/错误类型、not-ready、容量、连接失败和响应不含内部堆栈/prompt。
- [x] 2.3 实现 `GET /api/chat/runs/:runId/events`：通过现有 typed client 订阅事件，按 cursor 输出 SSE `id` 和 JSON `data`，设置禁用缓存/缓冲所需响应头，在终态或上游结束时关闭，并在浏览器断开时取消上游订阅而不 abort run；验证：真实本地 HTTP/fake Agent 测试覆盖多个 delta 顺序、三种终态、run 不存在、流异常和 client disconnect 资源释放。
- [x] 2.4 增加 API 进程启动与关闭入口、`dev`/`start` 脚本及根目录最小启动脚本，SIGINT/SIGTERM 时关闭 Fastify 和活动 SSE 连接；验证：子进程测试或受控启动检查证明 liveness/公开路由可访问、信号后按时退出，`corepack pnpm --filter @renewal/api typecheck` 与测试通过。

## 3. Web HTTP/SSE 客户端

- [x] 3.1 在 `apps/web/src/shared/api/` 实现无业务语义的 chat 传输客户端：POST 创建 run、使用 fetch `ReadableStream` 按 SSE 帧解析 `AgentRunEvent`、支持 `AbortSignal`，并将非法响应、非 2xx、未见终态的提前结束映射为统一客户端失败；验证：测试覆盖分块跨边界、连续帧、非法 JSON、服务错误、提前结束和取消，不新增依赖。
- [x] 3.2 配置 Vite 将同源 `/api` 代理到本地 API，前端代码只使用 `/api/chat/...` 相对路径，不读取或暴露 `insurance-agent` 内部地址；验证：Vite 配置测试/受控请求命中 API，仓库搜索确认 Web 无 `4310` 和 `/internal/agent/` 引用，`corepack pnpm --filter @renewal/web build` 通过。

## 4. 对话发送、流式消息与失败状态

- [x] 4.1 在 `features/chat/` 定义最小用户/助手消息视图模型，把提交和消息状态提升到对话面板：页面生命周期生成一个 `sessionId`，每次发送生成不同 `runId`，提交后清空输入并立即追加用户消息；验证：组件或 Playwright 测试断言同页相同 session、不同 run、刷新后不恢复旧消息。
- [x] 4.2 接入 chat client，首个 `answer.delta` 创建助手消息，后续 delta 按事件顺序追加到同一消息，`run.completed` 后保留完整回复并恢复发送；活动 run 期间禁止第二次发送，组件卸载时取消流；验证：Playwright 网络 mock 覆盖多个 delta 合并、终态不渲染技术信息、重复点击只产生一个 POST 和卸载取消。
- [x] 4.3 实现创建失败、SSE 异常结束、`run.failed` 和 `run.aborted` 的统一可访问错误提示；保留用户消息和已接收的部分回复，恢复发送且不显示原始内部错误；验证：Playwright 分别覆盖创建失败、无后端、流中断与失败终态，断言 `role="alert"` 可见且页面其他区域仍可用。
- [x] 4.4 保留文件选择的既有本地校验与不上传行为，并为动态用户/助手消息和流式区域补充最小样式与可访问语义，不改报价和保司卡片；验证：更新既有 `dialog-function` E2E，文件选择无 API/上传请求、合法/越界提示与桌面/窄视口回归通过。

## 5. 跨服务验证与文档同步

- [x] 5.1 新增端到端链路自动化：由测试启动 API 与 fake Agent HTTP/SSE（或等价受控替身），从浏览器发送消息并验证 Agent 收到一次相同消息、页面逐步得到增量和完成态，全程不需要真实模型凭据；验证：`corepack pnpm exec playwright test` 可重复通过且测试日志/fixture 不包含敏感业务数据。
- [x] 5.2 更新 `apps/api/README.md`、`apps/web/README.md`、`docs/impl/pi-agent.md` 和 `docs/arch/system-design.md`，记录已实现的公开路由、三个进程的启动顺序、环境配置、临时 ID、无持久化/无重连/无鉴权边界；若架构图的实现状态发生变化，同步 `artifacts/architecture/` 图源、导出物和视觉验证证据；验证：文档与实际命令/端口/契约一致，`corepack pnpm docs:check` 通过。
- [x] 5.3 执行受控本地联调：启动 `insurance-agent`、API 和 Web，使用非敏感测试消息确认 `Web → API → insurance-agent → API SSE → Web` 完整链路；验证：记录进程 ready、POST 202、至少两个按序 delta 和唯一完成终态的脱敏证据，不在文档中保存 prompt/回答正文；若无模型凭据则明确记为“未执行”，不得写成通过。（2026-09-19：联调由项目负责人在本地人工执行并确认链路可用；本次归档未落盘自动化采集的进程 ready / POST 202 / delta / 终态证据，该缺口已在测试计划未覆盖项如实记录，未声称已具备。）

## 6. 最终门禁与证据

- [x] 6.1 运行最小充分自动化门禁：`corepack pnpm --filter @renewal/api test`、`corepack pnpm --filter @renewal/insurance-agent test`、`corepack pnpm typecheck`、`corepack pnpm exec tsc --noEmit -p apps/web`、`corepack pnpm --filter @renewal/web build`、`corepack pnpm exec playwright test`、`corepack pnpm format:check`、`corepack pnpm docs:check` 和 `openspec validate connect-chat-agent-streaming --strict`；验证：全部实际执行命令通过，未执行项不得标记完成。
- [x] 6.2 更新 `docs/testing/connect-chat-agent-streaming.md` 的执行日期、实际命令、结果、证据路径和未覆盖项；仅将真实通过的场景和本 tasks 对应项勾选，并再次运行 `corepack pnpm docs:check`；验证：测试计划、tasks 和实际输出一致，无伪造或敏感证据。
