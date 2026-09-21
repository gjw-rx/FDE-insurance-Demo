/**
 * 契约公开入口。
 *
 * 只做 barrel 汇总：agent、chat 与 health 三组契约分别由各自子目录维护，
 * 消费方（apps/web、apps/api、apps/insurance-agent）统一从包根导入。
 *
 * agent 与 chat 使用 `export *`，因为除类型外还要转出受控取值的运行时数组
 * （如 `AGENT_RUN_STATUSES`）；这些数组是逻辑枚举取值的事实来源，业务代码需要
 * 在运行时按它校验取值，不能只作为类型存在。
 */
export * from "./agent/index.js";
export * from "./chat/index.js";
export type * from "./health/index.js";
