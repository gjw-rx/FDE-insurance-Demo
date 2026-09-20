import type { ApiNotReadyReason } from "../src/health/index.js";

/**
 * 编译期穷举表（health 契约）。
 *
 * 与 `agent-contract-coverage.ts`、`chat-contract-coverage.ts` 同一目的：一旦新增
 * 未就绪原因而没有同步更新，`tsc` 就会失败，避免部署平台依赖的就绪原因与实现
 * 静默漂移。
 */

export const API_NOT_READY_REASON_COVERAGE: Record<ApiNotReadyReason, true> = {
  DATABASE_UNREACHABLE: true,
  DATABASE_TIMEOUT: true,
};
