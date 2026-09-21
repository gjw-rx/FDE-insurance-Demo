import type {
  ChatApiErrorCode,
  ChatApiErrorResponse,
} from "@renewal/contracts";
import { ChatRequestError } from "../../application/errors/request_error.js";
import { ChatRunNotFoundError } from "../../application/run_coordinator.js";
import { ChatServiceClosedError } from "../../application/errors/service_closed_error.js";
import { ChatSessionStoreError } from "../../application/errors/store_error.js";
import { AgentClientError } from "../../infrastructure/agent/agent_service_client.js";

/**
 * 公开聊天接口的统一错误映射。
 *
 * 只输出稳定错误码、脱敏文案与 `retryable`；不透出内部地址、堆栈、上游原始消息，
 * 也不回显用户提交的内容（会话标题属于用户数据）。
 */

/** 构造错误响应体。 */
export function chatErrorBody(
  code: ChatApiErrorCode,
  message: string,
  retryable: boolean,
): ChatApiErrorResponse {
  return { error: { code, message, retryable } };
}

/** 映射后的 HTTP 结果。 */
export interface ChatErrorResponse {
  readonly statusCode: number;
  readonly body: ChatApiErrorResponse;
  /** 便于路由记录日志的稳定错误码。 */
  readonly code: ChatApiErrorCode;
}

const NOT_READY: ChatErrorResponse = {
  statusCode: 503,
  code: "SERVICE_NOT_READY",
  body: chatErrorBody("SERVICE_NOT_READY", "服务暂时不可用", true),
};

/**
 * 把内部错误映射为公开错误响应。
 *
 * 已知的稳定错误保留其错误码与 retryable；其余（连接、超时、协议、未知异常）
 * 统一映射为可重试的 `SERVICE_NOT_READY`。
 */
export function toChatErrorResponse(error: unknown): ChatErrorResponse {
  if (error instanceof ChatRequestError) {
    return {
      statusCode: 400,
      code: "INVALID_REQUEST",
      body: chatErrorBody("INVALID_REQUEST", error.message, false),
    };
  }
  if (error instanceof ChatSessionStoreError) {
    if (error.code === "CHAT_SESSION_NOT_FOUND") {
      return {
        statusCode: 404,
        code: "CHAT_SESSION_NOT_FOUND",
        body: chatErrorBody(
          "CHAT_SESSION_NOT_FOUND",
          "指定的会话不存在",
          false,
        ),
      };
    }
    return {
      statusCode: 503,
      code: "CHAT_SESSION_STORE_UNAVAILABLE",
      body: chatErrorBody(
        "CHAT_SESSION_STORE_UNAVAILABLE",
        "会话存储暂时不可用",
        true,
      ),
    };
  }
  if (error instanceof ChatRunNotFoundError) {
    return {
      statusCode: 404,
      code: "RUN_NOT_FOUND",
      body: chatErrorBody("RUN_NOT_FOUND", error.message, false),
    };
  }
  if (error instanceof ChatServiceClosedError) {
    return {
      statusCode: 503,
      code: "SERVICE_NOT_READY",
      body: chatErrorBody("SERVICE_NOT_READY", error.message, true),
    };
  }
  if (
    error instanceof AgentClientError &&
    error.kind === "service" &&
    error.serviceError !== undefined
  ) {
    return {
      statusCode: error.statusCode ?? 503,
      code: error.serviceError.code,
      body: chatErrorBody(
        error.serviceError.code,
        "Agent 服务拒绝了该请求",
        error.serviceError.retryable,
      ),
    };
  }
  return NOT_READY;
}
