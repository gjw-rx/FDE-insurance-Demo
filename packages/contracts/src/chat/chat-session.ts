/**
 * 业务聊天会话契约。
 *
 * 会话是用户可见的多段对话单元：一条 session 关联多个 run 和消息。
 * 标题长度、默认标题与分页上限是前后端共用的稳定约束，因此放在契约里，
 * 避免前后端各写一份常量后漂移。列表摘要只包含元数据，不含消息正文。
 */

/** 会话标题允许的最大长度，按 Unicode 码点计数。 */
export const CHAT_SESSION_TITLE_MAX_LENGTH = 60;

/** 新建会话的默认标题；用户在发送首条消息前看到的值。 */
export const DEFAULT_CHAT_SESSION_TITLE = "新会话";

/** 会话列表默认分页大小。 */
export const CHAT_SESSION_PAGE_SIZE_DEFAULT = 20;

/** 会话列表单页最大条数；超出即拒绝，避免一次拉取过多摘要。 */
export const CHAT_SESSION_PAGE_SIZE_MAX = 100;

/** 标题来源：默认标题、首条消息自动命名、用户手动重命名。 */
export type ChatSessionTitleSource = "default" | "first-message" | "manual";

/** 会话摘要：列表与详情共用的元数据，不含消息正文。 */
export interface ChatSessionSummary {
  readonly sessionId: string;
  readonly title: string;
  readonly titleSource: ChatSessionTitleSource;
  /** ISO 8601 时间戳。 */
  readonly createdAt: string;
  /** ISO 8601 时间戳；会话内任何消息变更都会更新。 */
  readonly updatedAt: string;
}

/** 消息角色。 */
export type ChatMessageRole = "user" | "assistant";

/**
 * 消息状态。
 *
 * `accepted` 与 `streaming` 表示仍在进行或等待回答；`send-failed` 表示用户消息
 * 未能创建 Agent run；`failed` 表示回答以失败终态收敛。失败状态不携带内部错误正文。
 */
export type ChatMessageStatus =
  | "accepted"
  | "send-failed"
  | "streaming"
  | "completed"
  | "failed";

/** 持久消息。顺序由服务端返回的数组顺序决定，不由时间戳推断。 */
export interface ChatMessage {
  readonly messageId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly role: ChatMessageRole;
  readonly status: ChatMessageStatus;
  readonly text: string;
  /** ISO 8601 时间戳。 */
  readonly createdAt: string;
}

/** 创建或重命名会话的响应：返回变更后的会话摘要。 */
export interface ChatSessionResponse {
  readonly session: ChatSessionSummary;
}

/**
 * 会话列表响应。
 *
 * `nextCursor` 缺省表示没有更多数据；调用方不得自行推断分页。
 */
export interface ChatSessionListResponse {
  readonly sessions: readonly ChatSessionSummary[];
  readonly nextCursor?: string;
}

/** 会话详情响应：会话摘要与该会话的有序消息。 */
export interface ChatSessionDetailResponse {
  readonly session: ChatSessionSummary;
  readonly messages: readonly ChatMessage[];
}

/** 重命名请求体；仅接受 title 字段。 */
export interface ChatSessionRenameRequest {
  readonly title: string;
}
