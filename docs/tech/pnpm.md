# pnpm

> 状态：已引入；版本：12.4.1

## 用途与选型

pnpm 管理 monorepo、单一锁文件和 workspace 内部依赖。`workspace:*` 用于确保内部包解析到当前仓库。

## 使用位置与配置

- 根 `package.json` 的 `packageManager` 是版本入口。
- `pnpm-workspace.yaml` 定义 workspace 与 catalog。
- 只维护根 `pnpm-lock.yaml`；安装和升级从仓库根目录执行。

## 验证与维护

运行 `pnpm install --frozen-lockfile` 与 `pnpm workspace:list`。新增允许执行安装脚本的依赖时，同步审查 `pnpm-workspace.yaml` 的 `allowBuilds`。

官方资料：[pnpm Workspace](https://pnpm.io/workspaces)。
