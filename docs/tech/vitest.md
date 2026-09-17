# Vitest

<!-- tech-packages: vitest -->

> 状态：已使用；版本：5.0.0

## 用途与选型

Vitest 用于独立 Agent 服务的单元与集成测试，以及 API 基础设施适配器的契约测试，与 TypeScript 和 Vite 工具链保持一致。

## 使用位置与配置

`apps/insurance-agent` 和 `apps/api` 将 Vitest 声明为开发依赖。测试统一放在各 workspace 顶层 `test/` 目录，不与 `src/` 生产代码混放；Agent 测试使用临时目录和 faux provider，API client 测试使用本地 fake HTTP 服务。

## 验证与维护

运行 `corepack pnpm test` 执行所有已配置的 workspace 测试；也可使用 `corepack pnpm --filter @renewal/insurance-agent test` 或 `corepack pnpm --filter @renewal/api test` 独立验证。

官方资料：[Vitest Projects](https://vitest.dev/guide/projects)。
