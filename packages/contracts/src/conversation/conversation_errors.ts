import type { AgentServiceErrorCode } from "../agent/agent_errors.js";

/**
 * 业务会话资源自身的稳定错误码。
 *
 * 输入类错误复用 Agent 契约的 `INVALID_REQUEST`，避免同一语义出现两个字面量；
 * 会话资源只新增「不存在」与「存储不可用」。错误响应不暴露存储实现、内部地址
 * 或堆栈。
 */
export type ChatSessionErrorCode =
 | Extract<AgentServiceErrorCode, "INVALID_REQUEST">
 | "CHAT_SESSION_NOT_FOUND"
 | "CHAT_SESSION_STORE_UNAVAILABLE";

/**
 * 公开聊天接口允许返回的全部稳定错误码。
 *
 * 会话路由与会话内的 run 路由共用同一错误信封，前端因此只需一套错误处理。
 */
export type ChatApiErrorCode = AgentServiceErrorCode | ChatSessionErrorCode;

/** 聊天接口统一错误响应体；与 Agent 错误响应同形。 */
export interface ChatApiErrorResponse {
 readonly error: {
  readonly code: ChatApiErrorCode;
  readonly message: string;
  readonly retryable: boolean;
 };
}
