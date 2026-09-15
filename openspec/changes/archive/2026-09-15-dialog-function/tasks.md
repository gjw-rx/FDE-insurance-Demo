## 1. 实现前文档准备

- [x] 1.1 更新 `docs/features/workbench-shell.md`：范围补充对话输入区（输入框、上传文件入口、类型提示「仅支持图片、PDF」、发送入口）、非目标补充「不实现真实上传与消息发送」，关联入口加入本 change（`openspec/changes/dialog-function/`）与 delta spec，主 spec 链接保持指向 `openspec/specs/workbench-shell/spec.md`。验证：`corepack pnpm docs:check` 通过且链接目标存在。
- [x] 1.2 创建 `docs/testing/dialog-function.md` 测试计划（状态：计划；链接 change、feature、主 spec 与 delta spec；按 delta spec 的 3 个 requirement 列出场景覆盖表，全部标「待实现」；记录验证命令与前置条件）。验证：`corepack pnpm docs:check` 通过。

## 2. 对话输入区实现

- [x] 2.1 在 `apps/web/src/app/icons.tsx` 新增回形针与向上箭头两个内联 SVG 图标组件，沿用现有 `stroke="currentColor"`、`strokeWidth="2"`、`aria-hidden` 写法，不新增依赖。验证：`corepack pnpm exec tsc --noEmit -p apps/web` 通过，且 `apps/web/package.json` 依赖无变化（`git diff --stat apps/web/package.json` 为空）。
- [x] 2.2 新增 `apps/web/src/app/chat-composer.tsx`：多行输入框（占位文案「输入您想咨询的车险问题...」）、「上传文件」按钮 + 隐藏 `input[type=file][accept="image/*,.pdf"]`、文案「仅支持图片、PDF」、圆形发送按钮（可访问名「发送」）；本地状态为输入文本与越界类型提示；发送按钮在输入为空时禁用、点击发送后清空输入且不追加消息气泡；文件类型本地校验失败时显示「仅支持图片、PDF 格式的文件」，通过时不显示提示、不记录文件、不发请求。验证：`corepack pnpm exec tsc --noEmit -p apps/web` 通过，且第 3.1 项用例中「空输入时发送不可用」「输入内容后发送并清空」「选择越界类型文件」三条通过。
- [x] 2.3 在 `apps/web/src/app/chat-panel.tsx` 的消息区之后渲染输入区组件，不改动助手标题与欢迎消息的既有结构与文案。验证：既有 `tests/e2e/front-init.spec.ts` 的「欢迎消息内容」用例通过。
- [x] 2.4 在 `apps/web/src/app/styles.css` 新增输入区样式（`chat-composer__*` 类，按 `designs/designs/dialog/export.png` 还原，优先复用既有 tokens），并仅为 `.chat-panel` 新增 `display: flex; flex-direction: column;`，输入区用 `margin-top: auto` 吸底、`width: 100%`、`box-sizing: border-box`、`resize: none`；不改动其他既有规则。验证：1212×786 视口下输入区与右列卡片底部对齐（`dialog-function.spec.ts` 布局用例通过），768px 视口下无横向滚动。

## 3. E2E 验收测试

- [x] 3.1 编写 `tests/e2e/dialog-function.spec.ts` 覆盖 delta spec 全部 scenario：输入区各元素与文案展示、其余区域展示不变、输入区底部对齐、空输入时发送不可用、输入后发送并清空且不新增消息、选择图片或 PDF 无错误提示、越界类型显示固定提示且不记录文件、输入区不发起网络请求。越界场景用 `setInputFiles` 向隐藏 input 注入 `.txt` 文件触发校验，不依赖系统文件对话框。验证：`corepack pnpm exec playwright test tests/e2e/dialog-function.spec.ts` 全部通过。
- [x] 3.2 运行既有用例确认其余区域零回归：`corepack pnpm exec playwright test`（含 `front-init.spec.ts`）全部通过，确认新增输入区未破坏既有结构、布局与定位断言。

## 4. 文档同步与验证

- [x] 4.1 更新 `apps/web/README.md`：如正文描述首屏包含区域，补充对话输入区与对应组件文件。验证：文件内容与实际目录一致，`corepack pnpm docs:check` 通过。
- [x] 4.2 核对 `docs/arch/`：确认模块边界、依赖方向与数据流无变化、无图源或产物需要更新；`docs/tech/` 与 `docs/impl/` 无新增依赖与第三方对接，无需变更。验证：核对结论写入 `docs/testing/dialog-function.md`。
- [x] 4.3 在 `docs/testing/dialog-function.md` 记录实际验证结果与证据：执行日期、命令（tsc 检查、playwright 用例、docs:check）、实际结果与证据路径，状态从「计划」更新为「通过」；未实际执行的命令不得记为通过。验证：表中所有命令均在当次实际执行且有真实输出。
- [x] 4.4 运行合并门禁：`openspec validate dialog-function --strict`、`corepack pnpm format:check`、`corepack pnpm docs:check` 全部通过。验证：命令输出无错误。
