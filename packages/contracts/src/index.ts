/**
 * 契约公开入口。
 *
 * 只做 barrel 汇总：agent、chat 与 health 三组契约分别由各自子目录维护，
 * 消费方（apps/web、apps/api、apps/insurance-agent）统一从包根导入。
 */
export type * from "./agent/index.js";
export * from "./chat/index.js";
export type * from "./health/index.js";
