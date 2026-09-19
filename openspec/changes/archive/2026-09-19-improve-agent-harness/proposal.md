## Why

本项目会话暴露出高思考等级用于机械动作、重复诊断与截断测试输出引发重跑的问题。用户已授权直接落实评审过的三项 Harness 改进，保持既有验收强度。

## What Changes

- 消除规则冲突和重复阅读要求，项目默认 medium，提供显式调整推理等级的工具；仅移除全局内部推理语言限制。
- 项目扩展过滤重复的已知非阻断诊断，保留真实错误；按文件版本判断读取是否仍有效。
- 提供统一验证入口，保存完整输出、真实退出码、输入指纹、重复失败记录与进程清理证据。
- 更新工程文档、技术说明和测试计划，通过现有同步器生成 Pi 配置副本。

## Capabilities

### New Capabilities

无。本次为工具和工程规范变更，使用 `skip_specs: true`。

### Modified Capabilities

无。不修改保险产品行为和现有业务 change 的任务状态。

## Impact

影响根 AGENTS、工程工作流、前端规则、OpenSpec 技能、package scripts、`.agents/harness/` 与本机项目 Pi 配置；全局仅调整中文语言规则并保存备份。不修改第三方 npm 安装包，不增加依赖，不启动真实模型请求，不自动提交。测试计划见 [测试计划](../../../docs/testing/improve-agent-harness.md)。
