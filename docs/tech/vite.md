# Vite

<!-- tech-packages: vite, @vitejs/plugin-react -->

> 状态：已引入；版本：Vite 8.3.0，React 插件 6.1.1

## 用途与选型

Vite 提供 React 工作台的开发服务器和生产构建能力，适合当前纯客户端应用。

## 使用位置与配置

依赖位于 `apps/web`。浏览器环境不持有模型或第三方服务密钥，所有业务写操作通过 API。

## 验证与维护

运行 Web 包的构建与 Playwright E2E。升级时复验 Node.js 版本约束、插件兼容性和生产资源路径。

官方资料：[Vite Guide](https://vite.dev/guide/)。
