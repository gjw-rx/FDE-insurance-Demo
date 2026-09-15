# 工作台首屏静态壳

> Feature：`workbench-shell`

## 背景与用户目标

仓库的设计基准 `designs/insurance-assistant.pen`（导出图 `designs/insurance-assistant.png`）及后续对话输入区设计稿 `designs/designs/dialog/export.png` 已确定车险续保工作台首屏的视觉方案，但 `apps/web` 此前只有工程骨架，没有可运行的页面。本需求把首屏按原型搭建为静态壳并补上对话输入区：页面可在无后端服务的环境中完整展示并支持局部本地交互，作为后续接入 API 与业务流程（对话、材料上传、报价、核保）的 UI 起点。

## 范围

- 首屏四个区域的结构与视觉还原：应用品牌栏（品牌图形标、产品名、问候与退出）、对话主区（助手标题与带时间戳的欢迎消息）、最新报价卡片（车牌标签与示例报价摘要）、保司设置卡片（四家保司清单）。
- 纯前端本地交互：报价信息「隐藏 / 显示」切换；保司「请选择 / 已选择」切换，同一时刻至多一家已选择。
- 桌面优先自适应布局：以 1212×786 原型为基准，基准视口下对话主区与右列卡片等高；较窄桌面视口（不小于 768px）收缩或堆叠，不出现横向滚动。
- 对话输入区（`designs/designs/dialog/export.png`）：多行输入框（占位文案「输入您想咨询的车险问题...」）、「上传文件」入口、文件类型提示文案「仅支持图片、PDF」和圆形发送按钮，固定在对话主区底部并与右侧卡片底部对齐。
- 输入区本地交互：可输入文本；发送按钮在输入为空时不可用，输入非空时点击发送后清空内容；「上传文件」打开文件选择器且 `accept` 限制为图片与 PDF，绕过选择器选中的越界类型被本地拒绝并提示「仅支持图片、PDF 格式的文件」。
- 页面数据全部来自前端内置静态示例数据（保司清单、车牌、欢迎文案、用户名、输入区文案）。
- 原型中模拟浏览器工具栏属于设计稿展示容器，不在页面实现范围内。

## 非目标

- 不调用任何后端接口，不实现数据加载、错误态、登录鉴权或 SSE。
- 不实现消息发送、消息列表渲染与智能体回复：点击发送只清空输入，不追加对话消息。
- 不实现真实文件上传、文件预览、上传进度或上传结果展示；不记录用户选中的文件。
- 不实现五项资料确认、真实报价获取或核保流程。
- 不单独设计移动端布局。
- 不引入新的 npm 依赖（含图标库、组件库、字体文件）。

## OpenSpec 关联

- 主 spec：[openspec/specs/workbench-shell/spec.md](../../openspec/specs/workbench-shell/spec.md)
- 归档 change：[2026-09-15-dialog-function](../../openspec/changes/archive/2026-09-15-dialog-function/)、[2026-09-15-front-init](../../openspec/changes/archive/2026-09-15-front-init/)
- 归档 Delta spec：[dialog-function](../../openspec/changes/archive/2026-09-15-dialog-function/specs/workbench-shell/spec.md)、[front-init](../../openspec/changes/archive/2026-09-15-front-init/specs/workbench-shell/spec.md)
- 测试计划：[front-init](../testing/front-init.md)、[dialog-function](../testing/dialog-function.md)

## 维护说明

可测试行为以 OpenSpec 为准，任务状态以 change 的 `tasks.md` 为准。本页只维护需求背景、边界和关联入口。
