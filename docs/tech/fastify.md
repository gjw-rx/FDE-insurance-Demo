# Fastify

<!-- tech-packages: fastify, @fastify/cors -->

> 状态：已引入；版本：Fastify 5.12.4，CORS 插件 11.3.0

## 用途与选型

Fastify 作为薄 HTTP 层，负责协议、鉴权、输入校验、错误映射和依赖装配；业务规则保留在 domain/application 包。

## 使用位置与配置

依赖位于 `apps/api`。跨域配置通过 `@fastify/cors` 注册，允许来源必须由部署环境明确配置。

## 验证与维护

使用 Fastify inject 进行 API 集成测试，并运行类型检查。升级主版本或修改插件配置时单独建立 change，复验 schema、错误码和 CORS 行为。

官方资料：[Fastify 文档](https://fastify.dev/docs/latest/)。
