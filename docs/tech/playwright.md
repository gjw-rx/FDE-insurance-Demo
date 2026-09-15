# Playwright

<!-- tech-packages: @playwright/test -->

> 状态：已引入依赖、测试待实现；版本：1.63.0

## 用途与选型

Playwright 用于验证真实浏览器中的关键用户旅程、断线恢复和前后端协同行为。

## 使用位置与配置

依赖位于仓库根目录。PR 计划运行 Chromium P0 场景，主干和发布前扩大浏览器范围；测试使用独立合成数据和可编程第三方替身。

## 验证与维护

实现 E2E 后运行项目 Playwright 命令并保留失败 trace、截图和脱敏日志。不得用固定 sleep 或增加重试掩盖稳定失败。

总体策略见 [E2E 测试策略](../testing/e2e-strategy.md)。官方资料：[Playwright Best Practices](https://playwright.dev/docs/best-practices)。
