/**
 * 业务 API 的健康与就绪状态。
 *
 * liveness 只表示进程存活；readiness 表示服务依赖（当前为 MySQL）可用，且此时
 * 才允许接收业务流量。两者必须分离：数据库不可用时进程仍然存活，但不应继续
 * 接收流量，否则请求会在执行阶段失败。
 *
 * 与 `agent-health.ts` 采用同一形状，使部署平台对两个进程使用一致的探针语义。
 */

/** 存活状态：只表示进程存活，不代表任何依赖可用。 */
export interface ApiLiveStatus {
  readonly status: "ok";
}

/** 未就绪原因（已脱敏，不含地址、凭据或驱动错误细节）。 */
export type ApiNotReadyReason = "DATABASE_UNREACHABLE" | "DATABASE_TIMEOUT";

/** 就绪状态：not-ready 时 `reasons` 非空，ready 时为空数组。 */
export interface ApiReadyStatus {
  readonly status: "ready" | "not-ready";
  readonly reasons: readonly ApiNotReadyReason[];
}
