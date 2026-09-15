# React

<!-- tech-packages: react, react-dom -->

> 状态：已引入；版本：19.3.0

## 用途与选型

React 用于登录后的车险续保工作台。当前产品没有 SEO 或服务端渲染要求，因此采用纯客户端应用。

## 使用位置与配置

依赖位于 `apps/web`。Web 只消费 `packages/contracts` 的 DTO 和事件契约，不直接依赖领域实体或 Pi SDK。

## 验证与维护

前端功能通过类型检查、构建和 Playwright 用户旅程验证。升级 React 与 React DOM 时保持版本一致，并复验 Vite 插件和测试定位器。

官方资料：[React TypeScript](https://react.dev/learn/typescript)。
