# Pi Coding Agent SDK

<!-- tech-packages: @earendil-works/pi-coding-agent, @earendil-works/pi-ai -->

> 状态：已在独立 Agent 服务中使用；版本：0.85.1

## 用途与选型

Pi SDK 用于独立服务中的受控 Agent 运行，包括模型 catalog、会话、事件、资源加载、extensions hook 和内置只读工具。它是基础设施适配器，不能成为业务状态来源；当前 change 不实现保险业务。

## 使用位置与配置

`apps/insurance-agent` 直接依赖 `pi-coding-agent`；测试使用同版本的 `pi-ai` faux provider。`apps/api` 只通过 typed HTTP/SSE client 调用。`ModelRuntime` 显式使用应用专属 `auth.json`、`models.json`、`models-store.json` 并有界刷新 catalog；每个 run 创建独立 `AgentSessionRuntime` 和内存 `SessionManager`。`DefaultResourceLoader` 使用专属 agentDir、内存 settings 与显式 skill/context allowlist。

活动工具严格为 Pi 内置 `read`、`grep`、`find`、`ls`，inline extension 在执行前检查 canonical path，阻止工作目录逃逸。MCP、sub-agent、第三方 extension、业务 custom tools、shell 和写文件能力均未使用，也不属于本 change 的实现范围。模型凭据只通过配置指定的环境变量注入。

## 验证与维护

默认验证使用 faux provider 和临时隔离目录：`corepack pnpm --filter @renewal/insurance-agent test`。真实模型只用于显式密钥控制的 smoke，且不记录 prompt/answer。升级时核对 SDK 类型、catalog、session/runtime、resource loader、hook 与工具事件，并保持无 ambient HOME discovery。

具体接口、权限与失败处理见 [Pi Agent 对接设计](../impl/pi-agent.md)。官方资料：[Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)。
