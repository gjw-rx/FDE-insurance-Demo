# 工作台首屏静态壳

> Feature：`workbench-shell`

## 背景与用户目标

仓库的设计基准 `designs/insurance-assistant.pen`（导出图 `designs/insurance-assistant.png`）已确定车险续保工作台首屏的视觉方案，但 `apps/web` 此前只有工程骨架，没有可运行的页面。本需求把首屏按原型搭建为静态壳：页面可在无后端服务的环境中完整展示并支持局部本地交互，作为后续接入 API 与业务流程（对话、材料上传、报价、核保）的 UI 起点。

## 范围

- 首屏四个区域的结构与视觉还原：应用品牌栏（品牌图形标、产品名、问候与退出）、对话主区（助手标题与带时间戳的欢迎消息）、最新报价卡片（车牌标签与示例报价摘要）、保司设置卡片（四家保司清单）。
- 纯前端本地交互：报价信息「隐藏 / 显示」切换；保司「请选择 / 已选择」切换，同一时刻至多一家已选择。
- 桌面优先自适应布局：以 1212×786 原型为基准，基准视口下对话主区与右列卡片等高；较窄桌面视口（不小于 768px）收缩或堆叠，不出现横向滚动。
- 页面数据全部来自前端内置静态示例数据（保司清单、车牌、欢迎文案、用户名）。
- 原型中模拟浏览器工具栏属于设计稿展示容器，不在页面实现范围内。

## 非目标

- 不调用任何后端接口，不实现数据加载、错误态、登录鉴权或 SSE。
- 不实现对话输入、消息发送、材料上传、五项资料确认、真实报价获取或核保流程。
- 不单独设计移动端布局。
- 不引入新的 npm 依赖（含图标库、组件库、字体文件）。

## OpenSpec 关联

- 主 spec：[openspec/specs/workbench-shell/spec.md](../../openspec/specs/workbench-shell/spec.md)
- 归档 change：[2026-09-15-front-init](../../openspec/changes/archive/2026-09-15-front-init/)
- Delta spec：[openspec/changes/archive/2026-09-15-front-init/specs/workbench-shell/spec.md](../../openspec/changes/archive/2026-09-15-front-init/specs/workbench-shell/spec.md)
- 测试计划：[docs/testing/front-init.md](../testing/front-init.md)

## 维护说明

可测试行为以 OpenSpec 为准，任务状态以 change 的 `tasks.md` 为准。本页只维护需求背景、边界和关联入口。
