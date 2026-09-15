## 1. 项目准备与文档入口

- [x] 1.1 创建 `docs/features/workbench-shell.md` 需求入口（背景、范围、非目标、OpenSpec 关联，主 spec 标注待归档生成，链接本 change 的 delta spec 与测试计划）。验证：`corepack pnpm docs:check` 通过。
- [x] 1.2 创建 `docs/testing/front-init.md` 测试计划（状态：计划；链接 change、feature 与 delta spec；按 delta spec 的 5 个 requirement 列出场景覆盖表，全部标「待实现」）。验证：`corepack pnpm docs:check` 通过。

## 2. 静态壳实现

- [x] 2.1 在 `apps/web/src/app/` 下实现应用入口与全局样式：`main.tsx`、`App.tsx`、`styles.css`（含 `:root` design tokens：颜色/圆角/阴影/字体栈）与静态示例数据模块（保司清单含初始选中态、车牌、欢迎文案、用户名）。验证：`corepack pnpm exec tsc --noEmit -p apps/web`（或使用既有 TS 检查方式）通过且新文件存在。
- [x] 2.2 实现 `App` 布局与四个区域组件：应用品牌栏（YiLiang 图形标、产品名、问候与退出）、对话主区（助手标题、时间戳欢迎消息）、最新报价卡片（车牌标签、示例报价摘要、隐藏入口）、保司设置卡片（四家保司、请选择/已选择状态，同一时刻至多一家已选择）。隐藏切换用 `useState`，保司选择用单选切换实现。验证：`corepack pnpm exec tsc --noEmit -p apps/web` 通过；`corepack pnpm --filter @renewal/web build` 成功产出 `dist/`。
- [x] 2.3 实现响应式布局：基准视口（≥1212px）按原型比例排列（对话主区居左、两张卡片右列纵排），约 ≤1024px 时卡片堆叠到对话区下方，全程无横向滚动。验证：浏览器/Playwright 在 1212×786 与 768px 宽视口下目测通过，无横向滚动条。

## 3. E2E 验收测试

- [x] 3.1 编写 `tests/e2e/front-init.spec.ts` 与 Playwright 配置：覆盖 delta spec 全部 scenario——页面加载四区域且无浏览器工具栏、欢迎消息内容、报价隐藏/恢复显示、保司初始状态与选中/取消切换、基准与窄视口布局、无后端环境页面可用。通过 `webServer` 启动 Vite dev server 运行。验证：`corepack pnpm exec playwright test` 全部通过（或仅本 change 新增用例稳定通过）。

## 4. 文档同步与验证

- [x] 4.1 更新 `apps/web/README.md`：目录与实现状态说明改为「首屏静态壳已实现」，描述新增的入口文件与区域组件。验证：文件内容与实际目录一致。
- [x] 4.2 检查 `docs/arch/system-design.md`：若正文含前端「不包含页面实现」类表述则同步为静态壳已实现；架构图不变。验证：`corepack pnpm docs:check` 通过。（实际无需修改：文档无此类表述。）
- [x] 4.3 在 `docs/testing/front-init.md` 记录实际验证结果与证据：执行日期、命令（tsc 检查、web build、playwright test、docs:check）、实际结果与证据路径，状态从「计划」更新为「通过」。验证：表中所有命令均在当次实际执行且有真实结果。
- [x] 4.4 运行合并门禁：`corepack pnpm format:check`、`corepack pnpm docs:check`、`openspec validate front-init --strict` 全部通过。验证：命令输出无错误。
