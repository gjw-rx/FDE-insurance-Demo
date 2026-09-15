## Why

`apps/web` 目前只有工程骨架（依赖、目录约定和 README），没有任何可展示的页面；而 `designs/insurance-assistant.pen` 及其导出图（`designs/insurance-assistant.png`）已经确定了首屏的视觉基准。在接入 API 与业务流程（roadmap 阶段 2 的其余部分）之前，先按原型把工作台首屏静态壳搭建出来，让后续迭代有可运行、可验收的 UI 起点。

## What Changes

- 在 `apps/web` 中按原型实现工作台首屏静态壳，包含四个区域：
  - 应用品牌栏：YiLiang 图形标、产品名「AI智能车险助手」、用户问候与退出入口。
  - 对话主区：助手标题（头像、名称、副标题）与欢迎消息气泡（含时间戳与多行文案）。
  - 最新报价卡片：标题、车牌标签与示例报价摘要，支持「隐藏」切换报价信息可见性。
  - 保司设置卡片：四家保司（中国平安保险、太平洋保险、国寿财、阳光保险）列表，支持「请选择 / 已选择」状态切换。
- 交互仅使用前端本地状态（React state），不调用任何后端接口。
- 按原型提取颜色、圆角、阴影与字体尺寸作为前端 design tokens；图标以手写内联 SVG 实现，不新增依赖。
- 布局以原型 1212×786 桌面视口为基准，桌面优先并自适应：较窄桌面视口下卡片合理收缩或堆叠，不单独设计移动端断点。
- 页面内容使用仓库内静态示例数据（保司清单、车牌、欢迎文案），集中在模块内声明。
- 原型顶部模拟浏览器工具栏（红黄绿按钮、前进/后退、编辑/设置/搜索等工具图标）属于设计稿展示容器，不在实现范围内。

### 非目标

- 不实现任何 API 调用、SSE、数据加载、错误态或登录鉴权。
- 不实现对话输入框、消息发送、材料上传、五项资料确认、报价获取或核保流程（由后续 change 处理）。
- 不实现移动端专属布局。
- 不新增 npm 依赖，不修改 `apps/api` 与 `packages/*`。

## Capabilities

### New Capabilities

- `workbench-shell`: 工作台首屏静态壳的外观结构、本地交互行为、响应式适配与示例数据边界。需求入口为 `docs/features/workbench-shell.md`（本 change 创建）。

### Modified Capabilities

（无：`openspec/specs/` 目前为空，没有需要修改的主 spec。）

## Impact

- 代码：`apps/web/src/` 新增应用入口、布局组件、design tokens 与静态示例数据；`apps/web` 的 Vite/TS 配置如需最小调整一并处理。
- 依赖：不新增运行时或开发依赖；图标用内联 SVG，字体沿用系统字体栈（原型 Inter 作为首选字体名，不做字体文件引入）。
- 外部服务：无。所有数据为前端静态示例数据。
- 文档：新增 `docs/features/workbench-shell.md` 需求入口与 `docs/testing/front-init.md` 测试计划；`apps/web/README.md` 的「当前只保留目录与依赖，不包含页面实现」表述同步更新；`docs/arch/system-design.md` 如有前端实现状态描述则同步（不改变架构图结构）。
