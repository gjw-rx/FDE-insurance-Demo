# E2E 测试目录

Playwright 测试按用户旅程组织，具体测试矩阵、环境和数据策略见 `docs/testing/e2e-strategy.md`。

| 测试文件                       | 覆盖范围                                                                    |
| ------------------------------ | --------------------------------------------------------------------------- |
| `front-init.spec.ts`           | 首屏静态区域、报价隐藏切换、保司选择与桌面自适应布局                        |
| `dialog-function.spec.ts`      | 对话输入区结构、文件类型校验与输入区网络边界                                |
| `agent-chat-streaming.spec.ts` | 对话流式链路（route mock）：发送、增量合并、并发限制与失败反馈              |
| `chat-pipeline.spec.ts`        | 端到端链路：真实业务 API 进程 + fake insurance-agent + 独立 Vite dev server |

`chat-pipeline.spec.ts` 在测试内启动受控替身，不需要真实模型凭据；fake Agent 只回放固定事件，断言不使用消息正文。
