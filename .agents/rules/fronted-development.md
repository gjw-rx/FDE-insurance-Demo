---
name: fronted开发规范
description: 约束 apps/web 的目录职责、依赖方向、React/TypeScript 实现方式与验证门禁。
applies_to:
  - apps/web/**
  - tests/e2e/**
---

# fronted开发规范

## 1. 适用范围与优先级

- 修改 `apps/web/**` 或前端 E2E `tests/e2e/**` 前，必须阅读并遵守本规则。
- 根目录 [`AGENTS.md`](../../AGENTS.md) 的项目级要求优先于本规则；工作流、OpenSpec、文档和 Git 要求仍以根规则及其引用文档为准。
- 本规则只约束前端工程实现，不覆盖产品需求、接口契约或业务验收标准。

## 2. 技术与架构边界

- 前端固定采用 React、TypeScript 和 Vite；不得自行引入其他前端框架、状态库、路由库或请求库。
- 保持 TypeScript `strict`，禁止使用 `any`、忽略类型错误或关闭既有严格检查来绕过问题。
- `apps/web` 只依赖 `@renewal/contracts`；不得直接依赖 `packages/domain`、Pi SDK、OCR SDK、保险公司 SDK 或后端内部实现。
- 前端校验只用于交互反馈，不能替代服务端权限、完整性、状态和幂等校验。
- 新增或升级依赖必须遵守项目技术文档与 OpenSpec 流程，并同步对应 `docs/tech/` 文档。

## 3. 目录职责

```text
apps/web/src/
├── app/                 # 启动入口、应用外壳、顶层组合、全局样式
├── features/<feature>/  # 按业务能力组织的组件、状态、数据映射和局部样式
├── shared/
│   ├── api/             # HTTP/SSE 客户端与通用协议处理
│   └── ui/              # 无业务语义、可跨 feature 复用的 UI
└── assets/              # 图片、字体等静态资源
```

### `app/`

- 只放应用启动、根组件、页面外壳、顶层布局组合和全局 design tokens。
- `App.tsx` 负责组合 feature，不承载具体业务流程和大段交互状态。
- 禁止把业务组件、业务数据、接口调用或通用图标继续堆放到 `app/`。

### `features/<feature>/`

- 业务组件、局部状态、静态示例数据、数据映射和 feature 专属样式放在所属 feature 内。
- 当前对话能力使用 `features/chat/`，续保、报价和保司设置使用 `features/renewal/`。
- 新能力优先新建语义明确的 feature；不要创建 `components/`、`utils/`、`common/` 等职责模糊的全局垃圾目录。
- feature 内部按实际需要直接组织文件，不为单个实现提前创建多层目录、公共入口或抽象层。

### `shared/`

- 只有至少两个 feature 可复用且不含业务语义的代码才能进入 `shared/`。
- 通用视觉组件放 `shared/ui/`；通用网络客户端和传输层处理放 `shared/api/`。
- 不得为了“以后可能复用”提前迁移到 `shared/`。

### `assets/`

- 图片、字体等静态资源统一放在 `assets/`，通过 Vite import 使用。
- 不在组件文件中嵌入大段二进制、Base64 或重复资源。

## 4. 依赖方向

```text
app ──> features ──> shared
 │          │           │
 └──────────┴──────────> @renewal/contracts
```

- `app` 可以组合 `features` 和 `shared`。
- `features` 可以依赖 `shared` 与 `@renewal/contracts`。
- `shared` 不得反向依赖 `features` 或 `app`。
- feature 之间默认不直接导入内部文件；跨 feature 的页面组合放在 `app`，真正通用的能力下沉到 `shared`。
- 禁止跨 workspace 包导入内部源码路径；只通过包公开入口消费契约。
- 避免循环依赖和无必要的 barrel 文件；当前规模下优先使用清晰的直接导入。

## 5. 文件放置判断

新增代码前按顺序判断：

1. 是否只负责启动或顶层组合？是则放 `app/`。
2. 是否包含对话、续保、报价、材料等业务语义？是则放对应 `features/<feature>/`。
3. 是否已被多个 feature 复用且没有业务语义？是则放 `shared/`。
4. 是否为静态资源？是则放 `assets/`。
5. 仍无法判断时先停止实现，说明职责与依赖歧义，不要默认塞进 `app/`。

## 6. React 与 TypeScript 约定

- 文件名使用 kebab-case；React 组件和类型使用 PascalCase；变量与函数使用 camelCase。
- 组件保持单一职责，状态放在最接近实际使用者的位置；不要为局部交互引入全局状态。
- 派生值直接计算，不为可由现有 state/props 推导的数据再建一份状态。
- 副作用只处理外部系统同步；不要用 `useEffect` 代替事件处理或纯计算。
- props 和公共函数使用明确类型；优先复用 `@renewal/contracts`，不得复制服务端 DTO。
- 静态数据归属对应 feature，禁止重新建立包含多个业务域的全局 `data.ts`。
- 只有实际重复出现时才提取 hook、工具函数或通用组件；单次使用不做预防性抽象。
- 保留现有代码风格和中文注释习惯；注释解释约束和原因，不复述代码。

## 7. 样式与可访问性

- `app/styles.css` 只新增全局 reset、design tokens 和应用外壳样式；新 feature 的专属样式优先与 feature 同目录放置。
- 不为遵守新规则而无关搬迁既有样式；涉及的旧样式可随对应 feature 变更逐步归位。
- 优先复用现有 CSS 变量、颜色、圆角和阴影，不散落重复 magic values。
- 保持现有 class 命名风格，避免影响其他 feature 的宽泛选择器。
- 交互元素优先使用原生语义元素；图标按钮必须有可访问名称，装饰图标使用 `aria-hidden="true"`。
- 键盘操作、禁用态、焦点态和错误提示必须可感知；不得只依赖颜色表达状态。
- 响应式修改至少覆盖项目既有桌面基准与窄视口，避免横向滚动和内容遮挡。

## 8. API、数据与安全

- HTTP/SSE 的通用连接逻辑放 `shared/api/`，feature 负责把契约数据转换为界面所需状态。
- 组件不得直接拼接后端内部路径、访问数据库或调用第三方保险服务。
- 不在浏览器状态、日志、截图、测试 fixture 或错误信息中暴露身份证号、材料正文、密钥等敏感信息。
- 加载、空数据、失败和重试行为以产品 spec 和接口契约为准，不自行发明业务语义。
- 模型回复或浏览器本地状态不能作为续保案件、报价、核保或出单状态的事实来源。

## 9. 测试与验证

- 行为变更必须补充或更新自动化测试；优先验证用户可观察行为，不测试组件内部实现细节。
- 前端关键流程和回归场景放在 `tests/e2e/`；测试名称使用中文描述业务场景。
- 纯目录重构也必须运行类型检查、生产构建和既有 E2E，证明导入关系与行为未改变。
- 在仓库根目录执行最小充分门禁：

```bash
corepack pnpm exec tsc --noEmit -p apps/web
corepack pnpm --filter @renewal/web build
corepack pnpm exec playwright test
corepack pnpm format:check
```

- 修改 Markdown 或项目文档时追加：

```bash
corepack pnpm docs:check
```

- 若任务对应活动 OpenSpec change，还必须按根 `AGENTS.md` 完成该 change 要求的测试、证据和归档流程。

## 10. 变更检查清单

提交前确认：

- [ ] 新文件放在职责正确的目录，没有把业务实现堆入 `app/`。
- [ ] 依赖方向为 `app -> features -> shared`，没有反向、跨 feature 内部或跨包内部导入。
- [ ] 没有新增无需求依据的依赖、抽象或全局状态。
- [ ] TypeScript 严格检查、构建、相关测试和格式检查通过。
- [ ] 目录结构变化已同步 `apps/web/README.md`。
- [ ] 文档、OpenSpec 和 Git 操作符合根 `AGENTS.md`。
