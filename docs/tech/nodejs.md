# Node.js

> 状态：已引入；版本：24.x

## 用途与选型

Node.js 是全仓开发、构建、API 与自动化脚本的统一运行时。前后端共用 TypeScript 工具链，减少多运行时配置差异。

## 使用位置与配置

- 根 `package.json` 的 `engines.node` 约束为 `>=24 <25`。
- `.nvmrc` 固定主版本，CI 和本地环境应保持一致。
- 后端与共享包使用 ESM。

## 验证与维护

运行 `node --version` 和 `pnpm workspace:list`。升级 Node.js 时单独建立 change，复验依赖安装、类型检查、构建与测试。

官方资料：[Node.js 文档](https://nodejs.org/docs/latest-v24.x/api/)。
