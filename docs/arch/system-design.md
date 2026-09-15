# 目标架构与 DDD 主体设计

> 本文描述项目骨架要演进到的目标架构与已确认边界，不代表每个业务模块都已实现。实际完成状态由代码、数据库迁移和自动化测试证明；产品行为和验收标准见 [OpenSpec](../../openspec/)。

## 核心原则

续保办理是强业务流程，保险问答是低延迟知识服务。两条路径共用用户工作台和业务 `sessionId`，但运行资源、工具集和完成条件相互隔离。

产品范围和用户体验原则见[产品愿景](../product/vision.md)，模块间依赖和工程决策见[文档地图](../README.md)。

投保五项固定为：VIN、发动机号、身份证号、车主姓名、车牌号。缺失、空白或存在未解决冲突时，服务端必须拒绝提交核保；前端置灰和 Agent 提示只能改善体验，不能代替门禁。

## DDD 边界

### Renewal bounded context

负责续保案件、五项资料、报价选择、提交幂等和核保状态。建议聚合根为 `RenewalCase`，保险公司响应通过防腐层翻译成项目内部状态。

### Conversation bounded context

负责业务会话、消息、运行和事件游标。业务 `sessionId` 是统一查询入口；Pi session 只是该会话下的一个运行时关联。

### Knowledge bounded context

负责保险知识检索、来源、版本和快速回答。一次请求最多一次检索、一次生成，不挂载续保业务工具。

### Material bounded context

负责上传材料、OCR 任务、字段候选、置信度和人工确认。原始材料与确认后的业务字段分开保存。

## 包与依赖方向

```text
apps/web ----------------------------> packages/contracts

apps/api ---> packages/application ---> packages/domain
    |                   |
    +-------------------+-------------> packages/contracts
    |
    +-- Pi / DB / OCR / Knowledge / Insurer adapters
```

- `domain` 不依赖任何其他 workspace 包。
- `application` 依赖 `domain` 和 `contracts`，定义用例和端口。
- `api` 实现端口并完成依赖装配。
- `web` 只消费 contracts，不直接使用领域实体或 Pi SDK。

## 两条执行路径

### 续保办理

1. Web 上传材料或提交人工输入。
2. Material 模块保存原件和字段候选。
3. 用户确认后，RenewalCase 更新五项资料及数据版本。
4. Pi Agent 根据当前案件状态选择受控业务工具。
5. 工具只接收 `renewalCaseId`、`quoteId` 等引用；应用服务重新加载真实数据并执行权限、完整性、状态和幂等校验。
6. 保险公司防腐层执行报价、核保、查询和出单请求。

### 快速保险问答

1. 路由器将保险知识问题送入 Knowledge 用例。
2. 知识库执行一次检索并返回带版本的来源片段。
3. 回答器执行一次生成并立即结束。
4. 该运行不拥有报价、核保、支付或出单工具，也不等待正在执行的续保 Agent。

## 状态与事实来源

| 数据                 | 事实来源                        |
| -------------------- | ------------------------------- |
| 续保案件和五项资料   | 业务数据库                      |
| 原始材料             | 对象存储，数据库保存元数据      |
| 报价、核保、出单状态 | 业务数据库 + 保险公司请求记录   |
| 对话与业务事件       | 会话/事件存储                   |
| Pi 上下文            | Pi session 存储或数据库恢复条目 |
| 排障链路             | trace/log backend               |

模型回复、Pi JSONL 文件和浏览器状态都不能覆盖业务数据库中的续保状态。

## 安全边界

- Pi 禁用通用 `bash`、文件写入和任意网络工具，只注册明确的保险业务工具。
- 身份证号、材料正文和保险公司凭据不得进入普通日志或 telemetry 属性。
- `sessionId` 是关联键，不是访问凭证；所有查询仍需用户或运营权限校验。
- 所有外部写操作带幂等键；超时后先查询状态，再决定是否重试。

## Archify 架构图

- 图源：[system-architecture.architecture.json](../../artifacts/architecture/system-architecture.architecture.json)
- 可交互 HTML：[system-architecture.html](../../artifacts/architecture/system-architecture.html)
- 类型与质量配置：architecture / showcase
- 图中展示用户与 React Web、业务 API、用例路由、续保和快速问答路径，以及 Pi Agent Runtime、受控保险业务工具、保险公司接口、知识库、业务数据库和材料对象存储之间的边界与连接。
- Archify showcase 校验：9 项检查全部通过，composition 错误和警告均为 0。
- 自动浏览器证据：[检查报告](../../artifacts/architecture/system-architecture.visual-check.json) · [截图总览](../../artifacts/architecture/system-architecture.visual-check.html)。Chrome 检查在 1440×900、1600×1000、1920×1080 和 2048×1320 视口通过，无溢出且可读性检查通过；截图覆盖 1440×900 与 2048×1320 的浅色和深色主题。
- 人工截图抽查：已检查 1440×900 浅色、1440×900 深色和 2048×1320 浅色截图，未见明显遮挡，主要架构路径和说明卡片清晰可读。
