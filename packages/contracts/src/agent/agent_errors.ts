/**
 * 内部 Agent 服务的稳定错误码。
 *
 * 约定：错误响应与 `run.failed` 事件只暴露这些码，不暴露 provider 原始错误、
 * 凭据、prompt 或文件内容。`retryable` 表示调用方可以安全重试同一请求。
 *
 * 数组是取值的运行时唯一来源，联合类型由它派生：业务 API 用它校验写入
 * `chat_run.error_code` 的取值，也用它校验从库中读回的取值。
 */
export const AGENT_SERVICE_ERROR_CODES = [
 /** 请求字段缺失、超长或格式非法。 */
 "INVALID_REQUEST",
 /** 配置非法或缺失，服务无法进入 ready。 */
 "CONFIG_INVALID",
 /** 配置模型不可解析、无凭据或 catalog 刷新失败。 */
 "MODEL_UNAVAILABLE",
 /** 服务尚未 ready，拒绝新 run。 */
 "SERVICE_NOT_READY",
 /** 活动 run 达到配置并发上限。 */
 "CAPACITY_EXCEEDED",
 /** 指定 runId 不存在或已超出事件保留期。 */
 "RUN_NOT_FOUND",
 /** 订阅起点早于服务保留的最小 cursor。 */
 "EVENT_CURSOR_EXPIRED",
 /** 未归类的服务内部错误。 */
 "INTERNAL_ERROR",
] as const;

export type AgentServiceErrorCode = (typeof AGENT_SERVICE_ERROR_CODES)[number];

/** 统一错误响应体。 */
export interface AgentErrorResponse {
 readonly error: {
  readonly code: AgentServiceErrorCode;
  readonly message: string;
  readonly retryable: boolean;
 };
}

/** 各错误码默认是否可重试。 */
export type AgentServiceErrorRetryable = Readonly<
 Record<AgentServiceErrorCode, boolean>
>;
