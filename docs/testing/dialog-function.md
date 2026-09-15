# dialog-function 测试计划

> 状态：通过

## 关联资料

- Change：[2026-09-15-dialog-function](../../openspec/changes/archive/2026-09-15-dialog-function/)
- 需求：[workbench-shell](../features/workbench-shell.md)
- 主 spec：[openspec/specs/workbench-shell/spec.md](../../openspec/specs/workbench-shell/spec.md)
- Delta spec：[openspec/changes/archive/2026-09-15-dialog-function/specs/workbench-shell/spec.md](../../openspec/changes/archive/2026-09-15-dialog-function/specs/workbench-shell/spec.md)

## 测试范围

- 测试层次：Playwright 浏览器 E2E（验收层），延续 front-init 的分层，不编写组件单元测试（见 design.md D8）。
- 前置条件：仓库根目录执行 `corepack pnpm install`；Playwright 浏览器已安装（`corepack pnpm exec playwright install chromium`）；Playwright 通过 `webServer` 自动拉起 Vite dev server，无需手动启动。
- 测试数据：页面内置静态示例数据；越界类型场景由测试在运行时生成的临时 `.txt` 文件提供（`setInputFiles` 注入隐藏 input），不依赖系统文件对话框。
- 外部服务替身：无。本 change 不发起任何网络请求，测试环境无需 API 服务或 mock。
- 回归范围：`tests/e2e/front-init.spec.ts` 全部用例必须继续通过，作为「其余区域零改动」的证据。

## 场景覆盖

| Requirement / Scenario                          | 测试层次   | 测试文件或用例                                    | 状态 |
| ----------------------------------------------- | ---------- | ------------------------------------------------- | ---- |
| 工作台首屏区域结构 / 页面加载完成               | Playwright | `tests/e2e/dialog-function.spec.ts`（结构断言）   | 通过 |
| 工作台首屏区域结构 / 欢迎消息内容               | Playwright | `tests/e2e/dialog-function.spec.ts`（输入区共存） | 通过 |
| 工作台首屏区域结构 / 输入区底部对齐             | Playwright | `tests/e2e/dialog-function.spec.ts`（底部对齐）   | 通过 |
| 对话输入区结构与文件类型提示 / 输入区各元素展示 | Playwright | `tests/e2e/dialog-function.spec.ts`（元素与文案） | 通过 |
| 对话输入区结构与文件类型提示 / 其余区域展示不变 | Playwright | `tests/e2e/dialog-function.spec.ts`（其余区域）   | 通过 |
| 对话输入区本地交互 / 空输入时发送不可用         | Playwright | `tests/e2e/dialog-function.spec.ts`（禁用态）     | 通过 |
| 对话输入区本地交互 / 输入内容后发送并清空       | Playwright | `tests/e2e/dialog-function.spec.ts`（发送清空）   | 通过 |
| 对话输入区本地交互 / 选择图片或 PDF 文件        | Playwright | `tests/e2e/dialog-function.spec.ts`（合法类型）   | 通过 |
| 对话输入区本地交互 / 选择越界类型文件           | Playwright | `tests/e2e/dialog-function.spec.ts`（越界拒绝）   | 通过 |
| 对话输入区本地交互 / 输入区不发起网络请求       | Playwright | `tests/e2e/dialog-function.spec.ts`（无请求）     | 通过 |

## 验证记录

| 日期       | 命令                                          | 实际结果   | 证据                                                                                                                               |
| ---------- | --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-15 | `corepack pnpm exec tsc --noEmit -p apps/web` | 通过       | 终端输出无错误                                                                                                                     |
| 2026-09-15 | `corepack pnpm exec playwright test`          | 20/20 通过 | 终端报告：dialog-function 10 条与 front-init 10 条全部通过；首次失败为「退出」入口定位，改用 link 角色后通过                       |
| 2026-09-15 | `corepack pnpm docs:check`                    | 通过       | 「24 个 Markdown 文件、1 个活动 change、14 个直接依赖」                                                                            |
| 2026-09-15 | `corepack pnpm format:check`                  | 通过       | 「All matched files use Prettier code style!」；首次报 2 个新文件格式问题，`prettier --write` 后重跑通过                           |
| 2026-09-15 | `openspec validate dialog-function --strict`  | 通过       | 「Change 'dialog-function' is valid」                                                                                              |
| 2026-09-15 | 视觉核对（1212×786 视口 @2x 截图人工比对）    | 通过       | 空态、输入态、越界提示三张本地截图：输入区为单一外框容器，占位文案、上传入口、类型提示与发送按钮位置与设计稿一致（截图未纳入仓库） |

## 未覆盖项

- 视觉还原程度不做像素级自动化断言（见 design.md 风险项），以设计稿 `designs/designs/dialog/export.png` 采样色值与人工比对为基准。
- 未覆盖系统文件选择器的原生过滤行为（`accept` 生效与否由浏览器实现决定），只覆盖绕过选择器后的本地校验路径。
- 「输入区底部对齐」按「贴附对话主区内容底部、保留对话主区下内边距」验收：设计稿中该间距更小（约 2px），因用户约束「其余样式禁止修改」未改动既有 `.chat-panel` 的 padding，已同步调整 delta spec 中该场景措辞。
