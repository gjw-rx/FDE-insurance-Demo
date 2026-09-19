# Agent Harness

<!-- tech-packages: pi-lens, @earendil-works/pi-coding-agent -->

> 状态：已引入；本项目的 Harness 辅助层不新增 npm 依赖。

## 用途与边界

Harness 负责降低 Agent 的重复推理与重复验证成本：项目规则消歧、非阻断诊断去重、分层思考等级和统一验证证据。它不改变产品行为，不替代 TypeScript、测试或 OpenSpec 的结果。

## 使用位置与配置

- `.agents/harness/pi-extension.mjs`：项目 Pi 扩展，注册 `harness_effort` 工具，并在发送给模型的上下文副本中过滤已知的重复非阻断提示；未知提示和真实错误保留。
- `.agents/harness/verify.mjs`：统一验证入口，完整输出写入 `.runtime/harness/`，记录真实退出码、输入指纹、超时/取消和定向进程清理结果。
- `.agents/harness/install.mjs`：幂等合并项目 `.pi/settings.json`，默认新会话使用 `medium`，保留既有模型、压缩和扩展设置，并触发已安装的工作区配置同步器。
- `package.json`：提供 `harness:install`、`verify:harness`、`verify:api`、`verify:web`、`verify:docs` 和 `verify:change`。

项目默认的 `medium` 不覆盖用户显式选择；复杂竞态或连续失败时可使用 `harness_effort` 切换到 `high`，机械操作完成后恢复 `medium`。

## 失败与重试

相同输入指纹和失败结果连续两次后，验证入口会阻止无理由的第三次执行。必须读取已有完整日志并通过 `--retry-reason "具体的新证据"` 记录环境或取证变化；源码、规则、配置或锁文件变化会生成新的指纹。验证入口只清理本次创建的进程组，不按进程名使用宽泛 kill。

## 验证与维护

```bash
corepack pnpm harness:install
corepack pnpm verify:harness
corepack pnpm verify:change improve-agent-harness
```

Harness 自测不请求模型。升级 Pi 或 pi-lens 后，应重新执行扩展加载检查、Harness 测试和格式/文档门禁，并确认诊断格式变化不会误过滤真实错误。

资料：[Pi 扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[pi-lens 配置文档](https://github.com/apmantza/pi-lens/blob/master/docs/configuration.md)。
