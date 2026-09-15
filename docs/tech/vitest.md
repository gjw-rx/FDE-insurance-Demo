# Vitest

> 状态：计划引入；目标版本：5.0.0

## 用途与选型

Vitest 计划用于领域、应用和 Fastify API 集成测试，与 TypeScript 和 Vite 工具链保持一致。

## 使用位置与配置

当前 package manifests 尚未声明 Vitest，因此不能将测试能力记为已实现。后续实现 change 应添加直接依赖、配置项目划分，并在本页加入 `tech-packages` 声明。

## 验证与维护

引入后验证领域测试、fake ports 和 Fastify inject 测试可独立运行，并在 CI 中纳入每次提交检查。

官方资料：[Vitest Projects](https://vitest.dev/guide/projects)。
