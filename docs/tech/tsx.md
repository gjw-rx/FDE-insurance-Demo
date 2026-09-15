# tsx

<!-- tech-packages: tsx -->

> 状态：已引入；版本：4.23.13

## 用途与选型

tsx 用于开发阶段直接执行 API 包中的 TypeScript 入口或脚本，避免单独维护运行时转译配置。

## 使用位置与配置

依赖位于 `apps/api`，仅用于开发工具链。生产运行应使用构建产物及明确的 Node.js 启动入口。

## 验证与维护

添加 API 启动脚本时验证进程启动、ESM 加载和退出信号。升级时复验 Node.js 与 TypeScript 版本兼容性。

官方资料：[tsx](https://tsx.is/)。
