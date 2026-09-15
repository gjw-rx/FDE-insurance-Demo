# TypeScript

<!-- tech-packages: typescript, @types/node, @types/react, @types/react-dom -->

> 状态：已引入；版本：TypeScript 7.0.2

## 用途与选型

TypeScript 为 Web、API 与共享包提供统一静态类型。全仓开启 strict，公共契约通过 `packages/contracts` 共享。

## 使用位置与配置

- 根 `tsconfig.base.json` 定义基础规则，各包配置继承并限定输入输出。
- 后端与共享包使用 ESM + NodeNext，Web 使用 bundler 解析。
- 包之间只从公开入口导入，领域模型不直接作为 HTTP DTO。

## 验证与维护

版本由 workspace catalog 与锁文件固定。升级时检查编译配置、公开类型和各包类型检查；禁止使用 `any` 绕过领域边界。

官方资料：[TSConfig strict](https://www.typescriptlang.org/tsconfig/strict.html)。
