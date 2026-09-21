/**
 * 服务停止期间拒绝新 run 的错误。
 *
 * 只承载稳定的 `SERVICE_NOT_READY`（可重试），不暴露进程状态或内部细节。
 */
export class ChatServiceClosedError extends Error {
 readonly code = "SERVICE_NOT_READY" as const;
 readonly retryable = true;

 constructor() {
  super("服务正在停止，暂不接受新的对话");
  this.name = "ChatServiceClosedError";
 }
}
