## Context

首屏静态壳（`workbench-shell`）已实现品牌栏、对话主区、最新报价与保司设置卡片，实现状态见归档 change `2026-09-15-front-init`。对话主区当前由 `apps/web/src/app/chat-panel.tsx` 渲染助手标题与一条欢迎消息，`.chat-panel` 是 grid 中的普通块级容器（`padding: 16px 20px`、`min-height: 400px`），没有输入入口；`front-init` 已把「对话输入框」明确列为非目标。

本次视觉基准是新增设计稿 `designs/designs/dialog/export.png`（整页截图，对话卡片底部新增输入区：多行输入框、左下「上传文件」按钮、类型提示文案、右下蓝色圆形发送按钮）。该图不是 Pen 源文件导出，因此没有可供读取的结构化坐标数据，配色与尺寸按截图逐项取值，并复用 `styles.css` 中既有 tokens。用户已确认三项边界：只做本地 UI 交互、文件限制同时落到文案与 `accept`、允许为吸底对 `.chat-panel` 做最小必要布局调整。

## Goals / Non-Goals

**Goals:**

- 对话卡片底部出现与设计稿一致的对话输入区，并在基准视口下贴齐卡片底部。
- 输入区具备可验收的本地交互：输入、发送清空、文件选择器类型限制、越界类型拒绝提示。
- 除输入区外，既有区域的结构、样式与交互零改动。

**Non-Goals:**

- 不定义消息发送契约、SSE、消息列表或智能体回复相关类型与状态。
- 不实现文件上传、预览、进度或错误重试；不引入状态管理库、组件库或图标库。
- 不为输入区引入移动端专属布局（沿用既有单一收窄断点行为）。

## Decisions

### D1: 输入区作为独立组件 `chat-composer.tsx`，仍留在 `src/app/`

- **做法**：新增 `apps/web/src/app/chat-composer.tsx` 承载输入区（输入框、上传入口、类型提示、发送按钮与本地状态），由 `chat-panel.tsx` 在消息区之后渲染。
- **理由**：延续 `front-init` D2 的分工——`src/features/chat/` 预留给真实对话业务，静态壳的展示组件留在 `src/app/`，避免接 API 时被迫迁移。输入区有独立状态与文件处理逻辑，从 `chat-panel.tsx` 拆出比继续内联更易验收。
- **备选**：直接写进 `chat-panel.tsx`（组件职责混杂，文件处理逻辑与消息展示耦合）；放进 `src/features/chat/`（提前占用业务模块语义）。

### D2: 吸底只通过 `.chat-panel` 增加纵向 flex 实现

- **做法**：既有规则只新增 `display: flex; flex-direction: column;`，输入区自身用 `margin-top: auto` 吸底并保留与消息的最小间距；`.chat-panel` 的 padding、颜色、圆角、`min-height` 等其他属性与其余所有既有规则保持原样。输入区样式全部以 `chat-composer__*` 新类名写在 `styles.css` 的对话主区段落之后。
- **理由**：卡片已经是 grid 项，`align-items: stretch` 会让两列等高，纵向 flex + `margin-top: auto` 是让输入区贴底的最小改动，不需要改 grid 或引入定位。
- **备选**：改用 `grid-template-rows: auto 1fr auto`（改动的既有属性更多）；`position: absolute` 贴底（需要给卡片定位与额外内边距，脆弱且会影响既有消息区宽度计算）。

### D3: 输入控件用无边框 `textarea` + 底部操作行

- **做法**：输入区是一个圆角浅色容器；内部上方为 `textarea`（`resize: none`、无边框、透明底、`width: 100%`、`box-sizing: border-box`），下方为操作行：左侧「上传文件」按钮 + 类型提示文案，右侧圆形发送按钮。占位文案「输入您想咨询的车险问题...」由 `placeholder` 提供。
- **理由**：设计稿中占位文案与操作行分处上下两行，且输入区整体是一个容器，`textarea` 最贴合该结构；`input` 在多数浏览器无法换行，长咨询文本体验差。禁用 resize 与固定 `box-sizing` 可避免用户拖动破坏卡片布局。
- **备选**：`contenteditable` 容器（无障碍与状态同步复杂，无必要）；`<input>`（不能换行）。

### D4: 文件选择用隐藏 `input[type=file]` + 按钮触发

- **做法**：组件内渲染隐藏的 `<input type="file" accept="image/*,.pdf">`，用 `useRef` 持有引用；「上传文件」是真实的 `<button>`，点击后调用 `input.click()`。`input` 的 `value` 在选择后重置，使同一文件可再次触发 `change`。
- **理由**：用 `button` 触发保留键盘可达性与既有按钮样式体系；把 `accept` 挂在真实 input 上，系统文件选择器即可按类型过滤，这是「文案 + accept 限制」中 `accept` 唯一有效的落点。发送按钮同样用 `<button>` 并添加可访问名（`aria-label="发送"`），便于 E2E 用角色定位。
- **备选**：用 `<label for>` 包裹（样式与语义需额外处理，且 label 文本会被读屏合并进控件名）；自定义弹层文件浏览器（超出范围）。

### D5: 文件类型在本地校验，越界时显示固定文案

- **做法**：`change` 事件里对文件做本地判断——`file.type` 以 `image/` 开头，或 `file.type === "application/pdf"`，或 MIME 缺失时文件名以 `.pdf` 结尾。判断通过则不显示任何提示、不记录文件、不发请求；判断失败则设置本地错误状态，在操作行下方渲染单行提示「仅支持图片、PDF 格式的文件」，并在下一次输入、发送或重新选择时清除。提示文案用既有字面量颜色风格（新增警示红 `#d9534f`），不新增 CSS 变量。
- **理由**：`accept` 只是选择器过滤，用户可以「所有文件」绕过，spec 明确要求这条越界路径有可观察结果；MIME 通常由浏览器给出，扩展名兜底可覆盖 MIME 为空的系统。
- **备选**：只依赖 `accept`（无法满足 spec 的越界场景）；把文件名展示出来（用户已确认本 change 不做上传结果展示）。

### D6: 本地状态用 `useState`，发送可用性由内容是否非空决定

- **做法**：组件内两个状态——输入文本与错误提示文案。发送按钮 `disabled={text.trim().length === 0}`；点击发送后清空文本与错误提示。全流程不调用任何接口，也不追加消息气泡。
- **理由**：延续 `front-init` D4，局部瞬态状态不需要状态库或 Context；禁用态是「输入为空时无法发送」最直接的可观察表达。
- **备选**：空内容点击时静默无响应（禁用态更明确，且便于测试断言）。

### D7: 新增图标仍用手写内联 SVG

- **做法**：在既有 `apps/web/src/app/icons.tsx` 中新增回形针（`PaperclipIcon`）与向上箭头（`ArrowUpIcon`）两个 SVG 组件，沿用现有 `stroke="currentColor"`、`strokeWidth="2"`、`aria-hidden` 写法。
- **理由**：延续 `front-init` D3 的零依赖约束；两个图标不足以支撑引入图标库。
- **备选**：lucide-react（违反零新增依赖约束）。

### D8: 测试沿用 Playwright 验收，新增 change 专属 spec 文件

- **做法**：新增 `tests/e2e/dialog-function.spec.ts` 覆盖 delta spec 全部 scenario；越界类型场景通过 `setInputFiles` 直接向隐藏 input 注入 `.txt` 文件触发校验，不依赖系统文件对话框。既有 `tests/e2e/front-init.spec.ts` 不改动，作为「其余区域零改动」的回归证据。
- **理由**：延续 `front-init` D7 的分层——spec 场景全部是浏览器可观察行为，仓库既有 E2E 方案与配置可直接复用；输入区逻辑只有局部状态与文件判断，单测会与 E2E 重复覆盖。
- **备选**：Vitest + Testing Library（`apps/web` 尚未配置 Vitest，且新增配置超出本 change 范围）。

### 文档影响清单

- 更新 `docs/features/workbench-shell.md`：范围补充对话输入区，关联入口加入本 change 与 delta spec，主 spec 链接保持指向 `openspec/specs/workbench-shell/spec.md`。
- 新增 `docs/testing/dialog-function.md`：实现前准备测试计划，实现后填写场景覆盖、验证命令与实际证据。
- 更新 `apps/web/README.md`：如正文描述首屏包含区域，补充对话输入区。
- `docs/tech/`：无新增或升级依赖，无技术资料变更；`docs/impl/`：无第三方服务对接，无变更。
- `docs/arch/`：不涉及模块边界、依赖方向或数据流变化，仅核对描述是否与实现一致；不新增 artifacts 图源或产物。

## Risks / Trade-offs

- [把 `.chat-panel` 改为纵向 flex 可能影响既有卡片高度与消息间距] → 只新增 `display` 与 `flex-direction`，不改动该规则其余属性；用既有 `front-init.spec.ts`（含 1212px 等高断言与 768px 无横向滚动断言）回归验证，失败则回退该改动、改用不影响既有属性的吸底方式。
- [`textarea` 默认尺寸导致窄视口横向滚动或撑破卡片] → 显式设置 `width: 100%`、`box-sizing: border-box`、`resize: none`，并在 768px 视口下断言 `scrollWidth ≤ clientWidth`。
- [错误提示出现/消失引起卡片高度跳动] → 提示为单行文本且限宽换行，渲染在操作行下方；如跳动明显，改为在操作行内预留固定高度（不新增其他区域变化）。
- [`accept` 过滤不保证文件类型，越界文件仍可能进入 change 事件] → 本地校验兜底并给出固定提示文案，spec 对两条路径分别给出场景。
- [设计稿是位图，颜色与间距只能目测取值，还原度易产生分歧] → 优先复用既有 tokens（背景、文字、描边、圆角、阴影），新增值只在输入区内部使用；验收以 spec 的结构与交互场景为准，不做像素级比对。
- [输入区默认 `main` 区域内出现表单控件，可能影响既有 E2E 文本定位] → 输入区使用独立类名与可访问名，占位文案与类型提示文案不与既有断言的文本重复；实现后完整运行既有用例确认无 strict mode 冲突。
