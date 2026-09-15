# Pi Coding Agent SDK

<!-- tech-packages: @earendil-works/pi-coding-agent -->

> 状态：已引入依赖、尚未实现适配器；版本：0.85.1

## 用途与选型

Pi SDK 用于后端受控 Agent 运行，包括会话、事件与保险业务工具编排。它是基础设施适配器，不能成为业务状态来源。

## 使用位置与配置

依赖位于 `apps/api`。浏览器不直接连接 Pi；业务工具必须重新加载案件并执行权限、完整性、状态和幂等校验。模型凭据只通过环境配置提供。

## 验证与维护

当前仅验证依赖安装和类型解析。实现适配器后增加 fake/contract 测试；真实模型只用于受控 sandbox smoke。升级时核对 SDK 类型、session 格式、工具事件和恢复行为。

具体接口、权限与失败处理见 [Pi Agent 对接设计](../impl/pi-agent.md)。官方资料：[Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)。
