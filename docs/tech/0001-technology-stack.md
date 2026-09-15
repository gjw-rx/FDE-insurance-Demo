# ADR-0001：TypeScript 单仓库技术栈

- 状态：Accepted
- 日期：2026-09-15
- 适用范围：项目工程骨架

## 决策

| 位置          | 选择                |   当前固定版本 | 说明                            |
| ------------- | ------------------- | -------------: | ------------------------------- |
| 运行时        | Node.js             |           24.x | 前后端工具链统一运行时          |
| 包管理        | pnpm                |         12.4.1 | workspace、严格依赖、单锁文件   |
| 语言          | TypeScript          |          7.0.2 | strict、ESM、统一类型规则       |
| Web           | React + Vite        | 19.3.0 / 8.3.0 | 客户端续保工作台，无 SSR 需求   |
| API           | Fastify             |         5.12.4 | 边界校验、插件隔离、注入式测试  |
| Agent         | Pi Coding Agent SDK |         0.85.1 | AgentSession、loop、工具与事件  |
| 单元/集成测试 | Vitest              |          5.0.0 | 与 TypeScript/Vite 工具链一致   |
| 浏览器 E2E    | Playwright          |         1.63.0 | 多浏览器、trace、webServer 管理 |

版本来自 2026-09-15 的 npm registry 查询。升级必须单独提交依赖变更，并重新验证 SDK 类型、构建和 E2E。

各技术的实际版本、使用位置与维护方式分别见 [Node.js](./nodejs.md)、[pnpm](./pnpm.md)、[TypeScript](./typescript.md)、[React](./react.md)、[Vite](./vite.md)、[Fastify](./fastify.md)、[Pi SDK](./pi-sdk.md)、[Playwright](./playwright.md)、[Prettier](./prettier.md)、[tsx](./tsx.md) 和 [Vitest](./vitest.md)。本 ADR 记录跨技术选型，单项资料随依赖状态维护。

## 为什么选择 pnpm

项目天然包含 Web、API、共享契约、领域层和应用层。pnpm workspace 可用一个锁文件管理全部包，并通过 `workspace:*` 明确声明内部包只能解析到本仓库；包未声明的依赖不会因为根目录安装而被隐式使用。官方 workspace 文档也说明了 `workspace:` 协议和共享锁文件的行为：[pnpm Workspace](https://pnpm.io/workspaces)。

本阶段不引入 Turborepo。当前包数量和 CI 规模不足以抵消额外编排配置；当全量构建时间成为可测瓶颈时再评估缓存层。

### 包管理约束

- 根 `package.json` 的 `packageManager` 是唯一 pnpm 版本入口。
- 只提交根 `pnpm-lock.yaml`，子包不得有独立锁文件。
- 内部包使用 `workspace:*`，外部生产依赖固定精确版本。
- workspace 禁止依赖环；依赖方向由 DDD 分层控制。
- 安装、升级和移除依赖均从仓库根目录执行。
- CI 使用 `pnpm install --frozen-lockfile`，锁文件不一致立即失败。
- pnpm 依赖构建脚本采用 `allowBuilds` 明确授权；当前仅允许 Pi/Vite 依赖链需要的 `@google/genai`、`esbuild` 和 `protobufjs`，新增项必须单独审查。

## 前端选择

React + TypeScript 与用户指定一致；Vite 提供开发服务器和生产构建，不引入 SSR、服务端组件或同构路由复杂度。React 官方说明 JSX 文件使用 `.tsx` 并配合 React 类型包：[React TypeScript](https://react.dev/learn/typescript)。Vite 官方提供 `react-ts` 模板与生产构建能力：[Vite Guide](https://vite.dev/guide/)。

未选择 Next.js，因为本产品首先是登录后的业务工作台，没有 SEO、内容预渲染或服务端组件需求。

## 后端选择

Fastify 作为薄 HTTP 层，只负责协议、鉴权、校验、错误映射和依赖装配。业务规则位于 domain/application 包。Fastify 的插件封装、schema 校验和注入式测试适合该边界：[Fastify Getting Started](https://fastify.dev/docs/latest/Guides/Getting-Started/)、[Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/)。

未选择 NestJS，因为当前不需要装饰器、反射元数据和大型模块容器。DDD 通过包依赖和端口实现，不依赖具体框架。

## TypeScript 规范

- 全仓开启 `strict`；官方说明该开关启用一组更严格的正确性检查：[TSConfig strict](https://www.typescriptlang.org/tsconfig/strict.html)。
- 后端和共享包使用 ESM + `NodeNext`；Web 使用 `Bundler` 模块解析。
- 文件名使用 kebab-case；类型、类使用 PascalCase；变量与函数使用 camelCase。
- DTO 只描述传输结构；领域模型不得直接作为 HTTP 响应。
- 公共 API 使用明确返回类型；禁止用 `any` 绕过领域边界。
- package 之间只通过公开入口导入，不跨包引用内部源码路径。
