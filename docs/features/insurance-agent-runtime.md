# insurance-agent 运行时

> Feature：`insurance-agent-runtime`

## 背景与用户目标

后端需要一个可以独立部署、独立启动的 Agent 运行时，用于承载续保助手的模型交互。此前 `apps/api` 只声明了 Pi SDK 依赖和适配器目录，没有可运行的 Agent 进程、稳定的内部调用接口，也没有与开发机 Pi 配置隔离的模型配置。

用户目标是：业务 API 能通过受控接口创建和停止 Agent run、按 cursor 订阅流式事件，同时部署环境不会隐式复用开发机的 Pi CLI 进程、会话、全局设置或凭据。

## 范围

- 独立部署的服务进程 `insurance-agent`，进程内嵌 Pi SDK，具备自身的配置、端口和 runtime data 目录。
- 通过 Pi SDK 原生能力装配 Agent session、agent loop、runtime、事件订阅、skills/resource loader、extensions 生命周期 hook 和内置工具。
- 只启用 Pi 内置只读工具 `read`、`grep`、`find`、`ls`，并用执行前 hook 限制其在受控工作目录内。
- 供业务 API 使用的内部 HTTP/SSE 契约：liveness、readiness、创建 run、订阅 run 事件、停止 run。
- 应用专属配置（`config/insurance-agent.json`）、显式配置隔离、密钥只从部署环境注入。
- 稳定的脱敏事件映射、cursor 续接、并发上限、超时与单一终态收敛。

## 非目标

- 不接入 MCP；Pi SDK `0.85.1` 没有内置 MCP，本需求不自建 bridge。
- 不新增第三方 Pi extensions、sub-agent、custom tools、后台 shell 或权限弹窗。
- 不实现续保报价、核保、材料识别等业务工具，不让模型成为业务状态来源。
- 不定义面向浏览器的公开会话 API 和前端消息渲染。
- 不共享或迁移当前开发环境的 Pi 会话、全局 settings、models 或 auth 文件。
- 不持久化 run 事件：首版只保留单进程内存状态，服务重启后不恢复。

## OpenSpec 关联

- 主 spec：[insurance-agent-runtime spec](../../openspec/specs/insurance-agent-runtime/spec.md)
- 归档 change：[2026-09-17-integrate-insurance-agent-runtime](../../openspec/changes/archive/2026-09-17-integrate-insurance-agent-runtime/)
- 归档 delta spec：[insurance-agent-runtime spec](../../openspec/changes/archive/2026-09-17-integrate-insurance-agent-runtime/specs/insurance-agent-runtime/spec.md)
- 测试计划：[integrate-insurance-agent-runtime 测试计划](../testing/integrate-insurance-agent-runtime.md)
- 架构与对接：[系统设计](../arch/system-design.md)、[Pi Agent 对接设计](../impl/pi-agent.md)、[Pi SDK 技术资料](../tech/pi-sdk.md)

## 维护说明

可测试行为以 OpenSpec 为准，任务状态以 change 的 `tasks.md` 为准。本页只维护需求背景、边界和关联入口。
