## Context

`apps/web` 是 pnpm workspace 中的 React 19 + Vite 8 + TypeScript 严格模式包，当前仅有目录约定（`src/app`、`src/features/{chat,renewal}`、`src/shared/{api,ui}`）和 `@renewal/contracts` 依赖，无任何页面实现。视觉基准来自 `designs/insurance-assistant.pen`（Pen 格式源文件）及其导出图 `designs/insurance-assistant.png`。原型中的浏览器顶部栏是设计工具的展示容器，不属于产品页面（见 proposal.md - What Changes）。

设计依据是 `.pen` 源文件中的结构化数据（坐标、尺寸、颜色、字号、图标名），而非仅凭截图目测。相关 token：页面背景 `#F3F5FF`、卡片 `#FFFFFF`、品牌紫 `#21149A`、点缀青 `#59C9DB`、主文字 `#171A25`、次级文字 `#8A90A1`、分割线 `#E8EAF2`、强调紫 `#6D63D8`、薄荷绿 `#5ECAC1`。

## Goals / Non-Goals

**Goals:**

- 一条命令可本地运行、可被 Playwright 打开并断言的工作台首屏静态壳。
- 视觉与交互还原所需的 design tokens 和静态示例数据有明确归属，后续接 API 的迭代能直接替换数据层而不重写布局。
- 页面在桌面优先的自适应布局下不出现横向滚动或内容重叠。

**Non-Goals:**

- 不引入组件库（antd/MUI 等）、图标库（lucide-react）、CSS 框架或样式方案库；不引入 Inter 字体文件。
- 不定义与后端契约相关的类型或状态管理方案。
- 不覆盖对话输入、消息发送、材料上传等后续业务交互。
- 不修改 `apps/api`、`packages/*` 与 `tests/` 下既有文件的结构。

## Decisions

### D1: 样式方案采用单文件全局 CSS + CSS 变量 tokens

- **做法**：`apps/web/src/app/styles.css` 定义 `:root` 上的 CSS 变量（颜色、圆角、阴影、字体栈）并承载全部组件样式；组件用语义化 class 组合，不使用 CSS Modules 或 CSS-in-JS。
- **理由**：静态壳只有一个页面、四类区域，样式总量小且团队当前未表达样式方案偏好；CSS 变量与原型变量一一对应，迁移成本最低，符合「Simplicity First」。Vite 原生支持，零新增依赖。
- **备选**：CSS Modules（隔离性好但本页无命名冲突压力）、Tailwind（新增依赖与配置，超出本 change 范围）、内联 style（无法表达 hover/响应式，不可行）。

### D2: 组件结构按原型区域划分为四个 feature 无关的布局组件

- **做法**：`src/app/` 下实现 `App`（组合布局）与四个区域组件（品牌栏、对话区、报价卡片、保司设置卡片）；区域组件从共享静态示例数据模块读取内容。对话相关内容留在布局组件内，不进入 `src/features/chat/`——`features/chat` 预留给真实的对话业务实现，避免静态壳占用业务模块语义。
- **理由**：静态壳没有业务流程，按视觉区域组织最直接；把欢迎消息塞进 `features/chat/` 会让后续接 API 时被迫迁移。
- **备选**：直接在 `App.tsx` 写一个巨型组件（无法按区域验收和测试）、按 README 的 features 目录提前分模块（为静态展示引入业务语义，过早抽象）。

### D3: 图标用手写内联 SVG，不引入图标库

- **做法**：图标（机器人 bot、文件 file-text、设置 settings-2、隐藏 eye-off、用户肩像等）以小型 SVG 组件形式实现在 `src/app/` 内的图标模块中，视觉与原型对齐即可，不追求与 lucide 源码逐字节一致。
- **理由**：原型图标总量少（约 10 个，其中浏览器栏图标已排除，实际约 6 个），lucide-react 的价值在于大图标集复用，此处收益不抵新增依赖。
- **备选**：lucide-react（违反本 change 零新增依赖约束；如果后续页面规模扩大可单独提 change 引入）。

### D4: 本地交互用 React useState，不引入状态管理

- **做法**：报价「隐藏/显示」和保司「请选择/已选择」都是组件内 `useState`；保司列表的初始选中状态来自静态示例数据（原型中太平洋保险为「已选择」，其余为「请选择」）。
- **理由**：两个交互均为局部、瞬态状态，无跨组件共享、无持久化需求；引入状态库或 context 都是投机性设计。
- **备选**：Context/Redux/Zustand（无共享需求，纯增加复杂度）。

### D5: 响应式采用单一收窄断点

- **做法**：容器用 flex/grid 布局，基准视口（≥1212px）下对话主区居左、两张卡片居右纵向排列，复刻原型比例；约 ≤1024px 时右列卡片换行到对话区下方堆叠，仍保持无横向滚动。不设移动端专属断点。
- **理由**：满足「桌面优先并自适应」的验收（spec：768px 以上不出现横向滚动），单一断点最简单可控。
- **备选**：多级断点 + 移动端重排（用户已确认非目标）。

### D6: 示例数据集中在一个静态模块

- **做法**：保司清单（含名称、英文名、品牌色、初始选中态）、车牌号、欢迎文案、用户名等集中在 `src/app/` 下的静态数据模块，类型就地定义；不放进 `@renewal/contracts`。
- **理由**：这些数据是 UI 展示替身而非前后端契约；放进 contracts 会伪造契约语义。集中管理让后续接 API 时只需替换一处。
- **备选**：数据散落在各组件（接 API 时多处修改）、放入 contracts（契约污染）。

### D7: 测试以 Playwright 验收为主

- **做法**：在 `tests/e2e/front-init.spec.ts` 编写覆盖 spec 全部 scenario 的验收测试（页面结构、欢迎消息、隐藏切换、保司切换、窄视口无横向滚动、无后端可用），通过 `webServer` 配置启动 Vite dev server 运行；不为静态壳编写组件单元测试。
- **理由**：spec 的全部 scenario 都是浏览器可观察行为，Playwright 是仓库既定 E2E 方案且已在根 devDependencies；静态组件无逻辑分支值得单测（两个 useState 的断言已被 E2E 覆盖）。
- **备选**：Vitest + Testing Library 组件测试（对纯静态壳是重复覆盖，且仓库 web 包尚未配置 Vitest）。

### 文档影响清单

- 新增 `docs/features/workbench-shell.md`（需求入口，链接本 change 与 delta spec）。
- 新增 `docs/testing/front-init.md`（测试计划，实现前准备）。
- 更新 `apps/web/README.md`：目录结构说明从「不包含页面实现」改为描述首屏静态壳。
- `docs/tech/`：无新增依赖，无 tech 文档变更；`docs/impl/`：无第三方对接，无 impl 文档变更。
- `docs/arch/system-design.md`：如正文描述了前端实现状态（「不包含页面实现」类表述）则同步为「首屏静态壳已实现」，架构图结构不变，不新增 artifacts 产物。

## Risks / Trade-offs

- [视觉还原程度无量化标准，评审易产生分歧] → 以 `.pen` 源文件的 tokens（颜色/字号/圆角/阴影）为实现与验收的对齐基准；像素级完全一致不作为验收条件，spec 场景只断言结构、文案与交互行为。
- [单文件全局 CSS 随页面增多会膨胀] → 本 change 内总量可控；若后续页面超过一个，届时在独立 change 中评估 CSS Modules 或框架方案，tokens 迁移到 CSS 变量已为此留好接口。
- [手写 SVG 图标与 lucide 原版有细微差异] → 验收只要求图标语义可辨识、位置与尺寸接近原型；差异过大时按原型截图逐个修正。
- [Vite dev server 端口或启动时序导致 E2E 不稳定] → Playwright `webServer` 使用 `reuseExistingServer` 与固定 URL；CI 中由 `webServer` 自行拉起，不依赖本地进程。
- [静态示例数据被误当作真实业务数据] → 数据模块与文档均标注「静态示例数据，仅用于展示」；接 API 的后续 change 负责替换。
