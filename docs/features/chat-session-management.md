# 聊天会话管理

> Feature：`chat-session-management`

## 背景与用户目标

此前工作台的对话只有页面生命周期内的临时 `sessionId`：用户无法主动开始一段新对话，也无法回到之前的对话，刷新页面后消息即丢失。用户需要把「会话」当作可管理的对象——能新建、能在历史之间切换、能重命名，从而在同一工作台里并行处理多段咨询。

界面以 pen 导出原型为视觉基准：主壳与卡片几何取自 `designs/insurance-assistant.html`（渲染图 `designs/insurance-assistant.png`），对话输入区取自 `designs/designs/dialog/export.png`。会话导航按该原型实现为「会话栏 + 会话面板」。

## 范围

- 业务 API 提供会话资源接口：创建会话、游标分页列出历史会话、读取指定会话及其有序消息、重命名会话。
- 新建会话默认标题为「新会话」；会话仍为默认标题时，首条成功提交的用户消息按「折叠空白 + 按码点截断」规则自动生成标题。
- 用户可手动重命名会话；手动标题优先，后续消息不再覆盖。
- 对话主区顶部提供会话栏：当前会话标题与相对更新时间、展开列表入口、以及「新会话」主按钮。
- 历史会话列表收纳在会话面板浮层中，按最近更新时间倒序展示标题与相对时间。展开/收起支持点击入口、关闭按钮、Escape 与点击外部；选中会话或新建会话后面板自动收起。
- 会话栏同时承担失败可见性：列表请求失败时直接在栏内展示失败与重试，不把失败藏进未展开的面板。
- 重命名入口位于会话面板的会话条目上，校验与失败回滚规则不变。
- 消息与 run 关联由业务 API 保存：用户消息在创建 run 前写入，助手回答由 API 侧唯一 run 消费者在终态时收敛；刷新页面后从历史会话恢复。
- 活动 run 期间禁止新建、切换会话与重命名，避免消息落到错误的会话。
- 会话详情切换使用请求序号丢弃过期响应，避免旧会话内容覆盖新选择。

## 非目标

- 不实现删除、归档、全文搜索会话，不支持跨部署实例同步或并发协作编辑。原型面板中的「搜索最近会话」输入框同样不实现（属于本需求非目标）。
- 不实现用户登录鉴权：当前会话历史是单部署实例内共享数据，界面与文档均不宣称用户级隔离。
- 不实现跨 API 重启的持久化与断线续接：会话数据只存在于业务 API 进程内，进程重启后清空；仓储以接口注入，后续由独立 change 替换为数据库实现。
- 不实现活动 run 的断线续接：页面重新加载后读取的是服务端已保存的最终状态。
- 不用模型生成标题，不实现会话摘要或自动分类。
- 不把 Pi 内部 session 作为业务查询入口。

## OpenSpec 关联

- 主 spec：[chat-session-management](../../openspec/specs/chat-session-management/spec.md)
- 归档 change：[2026-09-19-add-chat-session-management](../../openspec/changes/archive/2026-09-19-add-chat-session-management/)
- 归档 Delta spec：[chat-session-management](../../openspec/changes/archive/2026-09-19-add-chat-session-management/specs/chat-session-management/spec.md)
- 相关需求：[agent-chat-streaming](./agent-chat-streaming.md)、[workbench-shell](./workbench-shell.md)
- 测试计划：[add-chat-session-management](../testing/add-chat-session-management.md)
- 设计：[change design](../../openspec/changes/archive/2026-09-19-add-chat-session-management/design.md)

## 后续范围

以下 requirement 由本需求提出，但**未在本 change 实现**，已从归档的 delta spec 中移除，待后续持久化 change 实现并由其 ADD 进主 spec。原文保留在此作为需求依据：

> ### Requirement: 会话跨服务重启持久保存
>
> 系统 SHALL 将 session 元数据和已完成持久化的消息保存在业务 API 可恢复的存储中，使 API 正常重启后仍可列出并读取。单实例存储损坏或不可写时，系统 SHALL 拒绝相关写操作并返回脱敏错误，不得静默回退到临时内存状态。
>
> #### Scenario: API 重启后恢复
>
> - **WHEN** session 与消息已成功保存且业务 API 正常重启
> - **THEN** 历史列表和会话详情仍返回重启前已确认保存的数据
>
> #### Scenario: 存储不可写
>
> - **WHEN** 存储不可写且用户尝试创建、重命名或追加消息
> - **THEN** 系统返回稳定的服务错误，不报告操作成功，也不在日志中输出消息正文

后续 change 需同时完成：持久化仓储（文件或 DB）、schema 版本、写入原子性与启动校验；进程重启后把遗留 `streaming` 记录收敛为 interrupted，并证明重启不会重复启动 run。

## 维护说明

可测试行为以 OpenSpec 为准，任务状态以 change 的 `tasks.md` 为准。本页只维护需求背景、边界和关联入口。
