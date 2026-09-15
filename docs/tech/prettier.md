# Prettier

<!-- tech-packages: prettier -->

> 状态：已引入；版本：3.6.2

## 用途与选型

Prettier 统一代码、配置和 Markdown 的机械格式，减少不同开发者与 Agent 产生无意义格式差异。

## 使用位置与配置

根脚本 `pnpm format` 写入格式，`pnpm format:check` 只检查；`.prettierignore` 排除不应格式化的生成物。

## 验证与维护

提交前运行 `pnpm format:check`。升级时检查 Markdown 表格、JSON/YAML 和 TypeScript 的格式差异，避免夹带无关重排。

官方资料：[Prettier 文档](https://prettier.io/docs/)。
