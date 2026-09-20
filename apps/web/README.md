# Web 工作台

该应用采用 React + TypeScript + Vite，承载对话、材料上传、五项资料确认、报价和核保进度界面。当前已实现工作台首屏静态壳（见归档 change `openspec/changes/archive/2026-09-15-front-init/` 与 `2026-09-15-dialog-function/`）、最小对话流式链路（`2026-09-19-connect-chat-agent-streaming/`）以及聊天会话管理（归档 change `openspec/changes/archive/2026-09-19-add-chat-session-management/`）：可新建、切换、重命名会话，刷新后从历史会话恢复消息。

```text
src/
├── app/                            # 应用入口与页面外壳
│   ├── main.tsx                    # 应用入口
│   ├── App.tsx                     # 首屏布局组合
│   ├── brand-bar.tsx               # 应用品牌栏
│   ├── current-user.ts             # 外壳使用的静态用户信息
│   └── styles.css                  # 全局样式与 design tokens（颜色/圆角/阴影/字体栈）
├── features/
│   ├── chat/                       # 会话容器、历史导航、对话主区、消息模型与流式状态
│   └── renewal/                    # 报价、保司设置与静态续保数据
├── shared/
│   ├── api/                        # 对话 HTTP/SSE 与会话资源传输客户端
│   └── ui/                         # 无业务语义的通用 UI（当前为内联 SVG 图标）
└── assets/                         # 图片等静态资源
```

## 对话与会话链路

- `features/chat/chat-workspace.tsx` 是会话容器：持有历史列表、当前会话、消息、活动 run、面板展开状态与错误状态；活动 run 期间禁止新建、切换与重命名，切换详情用请求序号丢弃过期响应。
- `features/chat/chat-sessions.tsx` 渲染会话栏与会话面板：栏内展示当前标题与相对更新时间并提供「新会话」按钮，列表收纳在 326×326 浮层（支持展开/收起、Escape 与点击外部关闭）；`chat-panel.tsx` 只渲染欢迎消息、当前会话消息与输入区。
- `features/chat/messages.ts` 与 `session-list.ts` 是纯函数模块：把 `answer.delta` 收敛到同一条助手消息，按与服务端一致的规则合并会话列表，并格式化会话相对时间。
- `app/styles.css` 的 token 与几何数值取自 pen 导出原型 `designs/insurance-assistant.html` 与 `designs/designs/dialog/export.png`；界面变更请同时核对这两份设计稿。
- `shared/api/chat-client.ts` 只做 run 传输：`createChatRun` 创建 run，`streamChatEvents` 解析 SSE 并支持 `AbortSignal`；`shared/api/chat-session-client.ts` 只做会话资源的 create/list/detail/rename。
- 只消费稳定事件类型（`answer.delta` 与三种终态），不按回答文本推断报价、核保等业务状态；消息事实来源是业务 API，刷新后从服务端恢复。
- 会话数据当前保存在业务 API 进程内，API 重启后历史清空（见 change design 的「已确认的延期范围」）。

## 开发与验证

Vite dev server 将同源 `/api` 代理到本地业务 API，默认目标 `http://127.0.0.1:4300`，可用 `API_PROXY_TARGET` 覆盖；前端代码只使用 `/api/...` 相对路径，不持有 `insurance-agent` 内部地址或模型密钥。

```bash
corepack pnpm --filter @renewal/web dev      # Vite dev server
corepack pnpm --filter @renewal/web build    # 生产构建
corepack pnpm --filter @renewal/web test     # 传输客户端单元测试
corepack pnpm --filter @renewal/web typecheck
```

Web 只依赖 `@renewal/contracts`，不直接依赖领域实体、Pi SDK 或保险公司 SDK。
