# E2E 测试策略

## 目标

本文是目标测试设计，不表示测试已经实现或通过。实际的可观察行为以 OpenSpec 和已运行的测试为准；E2E 用于证明关键用户旅程和系统边界能协同工作，重点覆盖“资料不完整绝不能提交核保”。领域组合和字段规则由更快的单元/API 测试覆盖，避免把所有断言堆进浏览器测试。

## 测试层次

| 层次            | 工具                    | 运行频率               | 覆盖内容                             |
| --------------- | ----------------------- | ---------------------- | ------------------------------------ |
| Domain          | Vitest                  | 每次提交               | 五项完整性、状态机、幂等、数据版本   |
| Application     | Vitest + fake ports     | 每次提交               | 用例编排、一次检索一次生成、权限门禁 |
| API integration | Vitest + Fastify inject | 每次提交               | schema、错误码、DTO、SSE 游标        |
| Contract        | provider mock/sandbox   | 每日或发布前           | OCR、知识库、Pi 工具、保险公司协议   |
| Browser E2E     | Playwright              | PR 主路径 + 发布前全量 | 用户工作台关键旅程                   |
| Sandbox smoke   | Playwright/API client   | 发布前                 | 少量真实 Pi/保险公司沙箱链路         |

Playwright 官方建议测试用户可见行为并保持测试隔离：[Best Practices](https://playwright.dev/docs/best-practices)。它也支持由测试配置启动本地 Web server：[Web server](https://playwright.dev/docs/test-webserver)。Vitest workspace/project 能按包拆分测试配置：[Vitest Projects](https://vitest.dev/guide/projects)。

## P0 浏览器场景

### E2E-01：缺少发动机号禁止提交

1. 创建新业务会话。
2. 上传或填写 VIN、身份证号、车主姓名和车牌号，不提供发动机号。
3. 页面显示发动机号缺失，核保按钮不可用。
4. 测试再直接调用提交 API，服务端返回明确的缺字段错误。
5. 断言保险公司 mock 没有收到任何核保请求。

### E2E-02：五项完整后进入核保

1. 补齐发动机号并确认资料版本。
2. 页面显示五项完整并允许选择有效报价。
3. 提交核保，API 返回 `runId`/受理状态。
4. SSE 展示提交和结果事件，刷新页面后状态一致。
5. 使用同一幂等键重试，保险公司 mock 只收到一次请求。

### E2E-03：材料识别冲突

1. OCR 返回的车主姓名与已有确认值不同。
2. 页面显示冲突，案件不可提交。
3. 用户选择正确值并重新确认后，旧数据版本和旧报价失效。

### E2E-04：核保等待时快速问答

1. 保险公司 mock 延迟核保结果。
2. 用户询问“什么是交强险”。
3. 问答在独立 run 中返回一次回答和来源。
4. 断言没有调用续保工具，核保 run 继续保持原状态。

### E2E-05：断线恢复与统一查询

1. 在收到部分事件后断开 SSE。
2. 使用最后 event cursor 重连，只补发遗漏事件。
3. 使用原 `sessionId` 刷新，恢复相同 `renewalCaseId`、字段和状态。
4. 运营查询能关联 piSessionId、runId、traceId 和外部请求 ID，敏感字段已脱敏。

## 环境与替身

PR E2E 使用真实浏览器、真实 Fastify 进程和测试数据库；Pi、OCR、知识库和保险公司使用可编程 fake server。这样可以稳定制造缺字段、冲突、超时、重复回调和错误码。

已实现的链路用例（`tests/e2e/chat-pipeline.spec.ts`）启动真实 API 进程 + fake insurance-agent + 独立 Vite dev server。会话存储的事实来源已是 MySQL，因此该用例需要隔离数据库：从仓库根 `.env` 读取 `DATABASE_TEST_URL`（库名须含 `test`），未配置时跳过并给出原因，**不用内存存储代替**；用例开始前清空 `chat_session`/`chat_message`/`chat_run` 三张表，使「首屏没有历史会话」的断言与上次运行无关。启动摘要按 `api.started` 事件名解析，不依赖 stdout 行序（启动恢复日志可能先输出）。

发布前 sandbox smoke 才使用真实 Pi 模型和保险公司沙箱。测试账号、材料和身份证号必须是专用合成数据，禁止复制生产用户材料。

## 数据与隔离

- 每个测试创建自己的用户、sessionId 和 renewalCaseId。
- 测试完成后按测试 run 标签清理数据。
- 时间、ID 和保险公司响应在测试环境可控。
- 浏览器测试不得依赖执行顺序或复用上一用例的会话。
- 失败时保留 Playwright trace、截图、网络摘要和脱敏服务日志。

## 定位器和断言

- 优先使用 role、label 和用户可见文案，避免绑定 CSS 类名。
- 对副作用同时断言 UI、业务 API 状态和外部 mock 调用次数。
- 对 SSE 断言业务事件类型与游标，不断言 Pi 的内部事件名称。
- 不用固定 sleep；等待可观察状态或事件。

## CI 门禁

- PR 必跑：格式、类型、Domain/Application/API 测试、P0 Chromium E2E。
- 合并主干后：Chromium、Firefox、WebKit 全量 E2E。
- 发布前：数据库迁移、契约测试、Pi/保险公司 sandbox smoke、恢复演练。
- 任何 P0 失败都阻止合并；不允许通过增加重试掩盖稳定失败。
