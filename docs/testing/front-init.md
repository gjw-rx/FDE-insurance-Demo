# front-init 测试计划

> 状态：通过

## 关联资料

- Change：[2026-09-15-front-init](../../openspec/changes/archive/2026-09-15-front-init/)
- 需求：[workbench-shell](../features/workbench-shell.md)
- 主 spec：[openspec/specs/workbench-shell/spec.md](../../openspec/specs/workbench-shell/spec.md)
- Delta spec：[openspec/changes/archive/2026-09-15-front-init/specs/workbench-shell/spec.md](../../openspec/changes/archive/2026-09-15-front-init/specs/workbench-shell/spec.md)

## 测试范围

- 测试层次：Playwright 浏览器 E2E（验收层），不编写组件单元测试（设计决策 D7）。
- 前置条件：仓库根目录执行 `corepack pnpm install`；Playwright 通过 `webServer` 配置自动拉起 Vite dev server，无需手动启动。
- 测试数据：页面内置静态示例数据（保司清单、车牌「粤B196YS」、欢迎文案、用户「Max」），无外部测试数据文件。
- 外部服务替身：无。本 change 页面不发起任何网络请求，测试环境无需 API 服务或 mock。

## 场景覆盖

| Requirement / Scenario                      | 测试层次   | 测试文件或用例                               | 状态 |
| ------------------------------------------- | ---------- | -------------------------------------------- | ---- |
| 工作台首屏区域结构 / 页面加载完成           | Playwright | `tests/e2e/front-init.spec.ts`（结构断言）   | 通过 |
| 工作台首屏区域结构 / 欢迎消息内容           | Playwright | `tests/e2e/front-init.spec.ts`（欢迎消息）   | 通过 |
| 最新报价卡片信息隐藏切换 / 隐藏报价信息     | Playwright | `tests/e2e/front-init.spec.ts`（报价隐藏）   | 通过 |
| 最新报价卡片信息隐藏切换 / 恢复显示报价信息 | Playwright | `tests/e2e/front-init.spec.ts`（报价显示）   | 通过 |
| 保司选择状态切换 / 初始选择状态             | Playwright | `tests/e2e/front-init.spec.ts`（初始状态）   | 通过 |
| 保司选择状态切换 / 切换选中保司             | Playwright | `tests/e2e/front-init.spec.ts`（单选切换）   | 通过 |
| 保司选择状态切换 / 取消选中一家保司         | Playwright | `tests/e2e/front-init.spec.ts`（取消选中）   | 通过 |
| 桌面优先自适应布局 / 基准桌面视口           | Playwright | `tests/e2e/front-init.spec.ts`（基准视口）   | 通过 |
| 桌面优先自适应布局 / 较窄桌面视口           | Playwright | `tests/e2e/front-init.spec.ts`（窄视口）     | 通过 |
| 无后端服务的静态展示 / 无后端环境打开页面   | Playwright | `tests/e2e/front-init.spec.ts`（无后端可用） | 通过 |

## 验证记录

| 日期       | 命令                                                           | 实际结果   | 证据                                                                                                                                       |
| ---------- | -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-15 | `corepack pnpm exec tsc --noEmit -p apps/web`                  | 通过       | 终端输出无错误                                                                                                                             |
| 2026-09-15 | `corepack pnpm --filter @renewal/web build`                    | 通过       | 产出 `apps/web/dist/`（index.html、CSS、JS），终端构建日志                                                                                 |
| 2026-09-15 | `corepack pnpm exec playwright test`                           | 10/10 通过 | 终端测试报告（含每条用例耗时）；首次失败为选择器歧义，已修复后重跑通过                                                                     |
| 2026-09-15 | `corepack pnpm docs:check`                                     | 通过       | 「23 个 Markdown 文件、1 个活动 change、14 个直接依赖」                                                                                    |
| 2026-09-15 | `corepack pnpm format:check`                                   | 通过       | 「All matched files use Prettier code style!」；其中 6 个 HEAD 预存文件（`.agents/skills/*.md` × 5、`pnpm-lock.yaml`）经用户确认后一并修复 |
| 2026-09-15 | `openspec validate front-init --strict`                        | 通过       | 「Change 'front-init' is valid」                                                                                                           |
| 2026-09-15 | `corepack pnpm exec playwright test`（品牌栏与等高改动后重跑） | 10/10 通过 | 新增品牌栏断言（图形标、产品名仅「AI智能车险助手」）与基准视口等高断言（对话主区与右列高差 ≤ 1px）均通过                                   |

## 未覆盖项

- 首次运行 `playwright test` 时因本机未安装 Playwright 浏览器（chromium_headless_shell）导致 10 个用例全部失败，执行 `corepack pnpm exec playwright install chromium` 后重跑全部通过；该失败属环境准备问题，非代码缺陷。
- 视觉还原程度未做像素级自动化断言（见 design.md 风险项），以 `.pen` 源文件 tokens 为人工基准。
