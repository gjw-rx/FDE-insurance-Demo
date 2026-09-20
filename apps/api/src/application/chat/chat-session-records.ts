import type { AgentRunSnapshot, AgentRunStatus } from "@renewal/contracts";
import type {
  ChatMessageRole,
  ChatMessageStatus,
  ChatSessionTitleSource,
} from "@renewal/contracts";

/**
 * 会话仓储的内部记录模型。
 *
 * 这些类型只在应用层与仓储实现之间传递，不外泄给 HTTP 契约；对外 DTO 由
 * `chat-session-service.ts` 转换，避免存储细节（如 run 快照、顺序位）进入契约。
 */

/** 会话记录。 */
export interface ChatSessionRecord {
  readonly sessionId: string;
  readonly title: string;
  readonly titleSource: ChatSessionTitleSource;
  /** ISO 8601 时间戳。 */
  readonly createdAt: string;
  /** ISO 8601 时间戳；会话内消息变更时更新，用于列表排序。 */
  readonly updatedAt: string;
}

/** 消息记录。同会话内的先后顺序由仓储保存的数组顺序决定。 */
export interface ChatMessageRecord {
  readonly messageId: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly role: ChatMessageRole;
  readonly status: ChatMessageStatus;
  readonly text: string;
  /** ISO 8601 时间戳。 */
  readonly createdAt: string;
}

/** run 记录：承载幂等所需的快照与终态，避免重复启动 Agent run。 */
export interface ChatRunRecord {
  readonly runId: string;
  readonly sessionId: string;
  readonly status: AgentRunStatus;
  /** Agent 接受后的快照；创建失败时缺省。 */
  readonly snapshot?: AgentRunSnapshot;
  /** ISO 8601 时间戳。 */
  readonly createdAt: string;
  /** ISO 8601 时间戳。 */
  readonly updatedAt: string;
}

/** 列表游标位置：排序键为 (updatedAt DESC, sessionId DESC)。 */
export interface ChatSessionCursor {
  readonly updatedAt: string;
  readonly sessionId: string;
}
