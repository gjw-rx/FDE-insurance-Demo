/**
 * 健康与就绪状态。
 *
 * liveness 只表示进程存活；readiness 表示配置、资源、模型 catalog 与凭据均可用，
 * 且此时才允许创建新 run。
 */
export interface AgentLiveStatus {
 readonly status: "ok";
 readonly agentName: string;
}

/** not-ready 原因（已脱敏，不含凭据或文件内容）。 */
export type AgentNotReadyReason =
 | "CONFIG_INVALID"
 | "MODEL_UNAVAILABLE"
 | "RESOURCES_INVALID";

export interface AgentReadyStatus {
 readonly status: "ready" | "not-ready";
 readonly agentName: string;
 readonly model: {
  readonly provider: string;
  readonly id: string;
 };
 /** status 为 not-ready 时列出原因；ready 时为空数组。 */
 readonly reasons: readonly AgentNotReadyReason[];
}
