# Fastify

<!-- tech-packages: fastify, @fastify/cors -->

> 状态：已引入；版本：Fastify 5.12.4，CORS 插件 11.3.0

## 用途与选型

Fastify 作为薄 HTTP 层，负责协议、鉴权、输入校验、错误映射和依赖装配；业务规则保留在 domain/application 包。

## 使用位置与配置

依赖位于 `apps/api`。当前公开对话路由仅面向同源访问（开发环境经 Vite `/api` 代理，生产由同源网关提供），因此未注册 CORS；如部署确需跨域，才使用 `@fastify/cors` 并明确配置允许来源。

## 验证与维护

使用 Fastify inject 进行 API 集成测试，并运行类型检查。升级主版本或修改插件配置时单独建立 change，复验 schema、错误码和 CORS 行为。

官方资料：[Fastify 文档](https://fastify.dev/docs/latest/)。
