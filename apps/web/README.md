# Web 工作台

该应用采用 React + TypeScript + Vite，承载对话、材料上传、五项资料确认、报价和核保进度界面。当前已实现工作台首屏静态壳（见归档 change `openspec/changes/archive/2026-09-15-front-init/` 与 `2026-09-15-dialog-function/`）以及最小对话流式链路（见归档 change `openspec/changes/archive/2026-09-19-connect-chat-agent-streaming/`）：发送文本后通过业务 API 创建 Agent run，并把 SSE 回答增量拼接为一条助手消息。

```text
src/
├── app/                            # 应用入口与页面外壳
│   ├── main.tsx                    # 应用入口
│   ├── App.tsx                     # 首屏布局组合
│   ├── brand-bar.tsx               # 应用品牌栏
│   ├── current-user.ts             # 外壳使用的静态用户信息
│   └── styles.css                  # 全局样式与 design tokens（颜色/圆角/阴影/字体栈）
├── features/
│   ├── chat/                       # 对话主区、输入区、消息模型与流式状态
│   └── renewal/                    # 报价、保司设置与静态续保数据
├── shared/
│   ├── api/                        # 对话 HTTP/SSE 传输客户端（chat-client.ts）
│   └── ui/                         # 无业务语义的通用 UI（当前为内联 SVG 图标）
└── assets/                         # 图片等静态资源
```

## 对话链路

- `features/chat/chat-panel.tsx` 持有消息列表、页面级临时 `sessionId`、活动 run 与失败状态；`feature/chat/chat-composer.tsx` 保留文件类型本地校验，文本提交交给面板层。
- `shared/api/chat-client.ts` 只做传输：`createChatRun` 创建 run，`streamChatEvents` 用 fetch 解析 SSE 并支持 `AbortSignal`；非法响应、非 2xx 与「未见终态的提前结束」统一映射为 `ChatClientError`。
- 只消费稳定事件类型（`answer.delta` 与三种终态），不按回答文本推断报价、核保等业务状态；消息不做持久化，刷新后回到欢迎消息。

## 开发与验证

Vite dev server 将同源 `/api` 代理到本地业务 API，默认目标 `http://127.0.0.1:4300`，可用 `API_PROXY_TARGET` 覆盖；前端代码只使用 `/api/...` 相对路径，不持有 `insurance-agent` 内部地址或模型密钥。

```bash
corepack pnpm --filter @renewal/web dev      # Vite dev server
corepack pnpm --filter @renewal/web build    # 生产构建
corepack pnpm --filter @renewal/web test     # 传输客户端单元测试
corepack pnpm --filter @renewal/web typecheck
```

Web 只依赖 `@renewal/contracts`，不直接依赖领域实体、Pi SDK 或保险公司 SDK。
