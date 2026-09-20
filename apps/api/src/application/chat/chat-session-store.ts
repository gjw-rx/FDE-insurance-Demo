import type { AgentRunSnapshot } from "@renewal/contracts";
import type { ChatSessionTitleSource } from "@renewal/contracts";
import type {
  ChatMessageRecord,
  ChatRunRecord,
  ChatSessionCursor,
  ChatSessionRecord,
} from "./chat-session-records.js";

/**
 * 会话仓储端口。
 *
 * 应用层只依赖这个接口；实现可以是进程内内存、文件或数据库。所有写入方法都由
 * 实现保证按调用顺序串行生效，应用层不处理并发写冲突。
 *
 * 契约约定：
 * - 方法在会话或 run 不存在时抛 `ChatSessionStoreError`（`CHAT_SESSION_NOT_FOUND`）。
 * - 方法不抛实现细节异常；不可写时统一抛 `CHAT_SESSION_STORE_UNAVAILABLE`。
 * - `now`/时间戳由应用层传入，仓储不自取系统时间，便于测试确定性。
 */

/** 创建会话的入参。 */
export interface CreateSessionParams {
  readonly sessionId: string;
  readonly title: string;
  readonly createdAt: string;
}

/** 重命名的入参。 */
export interface RenameSessionParams {
  readonly sessionId: string;
  readonly title: string;
  readonly titleSource: ChatSessionTitleSource;
  readonly updatedAt: string;
}

/** 列表查询入参。 */
export interface ListSessionsParams {
  readonly limit: number;
  readonly after?: ChatSessionCursor;
}

/** 追加用户消息的入参；`autoTitle` 仅在会话仍为默认标题时生效。 */
export interface AppendUserMessageParams {
  readonly sessionId: string;
  readonly runId: string;
  readonly messageId: string;
  readonly text: string;
  readonly createdAt: string;
  readonly autoTitle?: string;
}

/** 追加用户消息的结果；`created` 为 false 表示 runId 已存在，未重复写入。 */
export interface AppendUserMessageResult {
  readonly created: boolean;
  readonly session: ChatSessionRecord;
  readonly message: ChatMessageRecord;
  readonly run: ChatRunRecord;
}

/** 写入 Agent 接受结果。 */
export interface SetRunAcceptedParams {
  readonly runId: string;
  readonly snapshot: AgentRunSnapshot;
  readonly updatedAt: string;
}

/** 标记 run 创建失败（用户消息置为发送失败）。 */
export interface SetRunCreateFailedParams {
  readonly runId: string;
  readonly updatedAt: string;
}

/** 创建助手消息（进入 streaming）。 */
export interface StartAssistantMessageParams {
  readonly runId: string;
  readonly messageId: string;
  readonly createdAt: string;
}

/** 追加回答增量。 */
export interface AppendAssistantDeltaParams {
  readonly runId: string;
  readonly text: string;
  readonly updatedAt: string;
}

/** run 终态。 */
export type ChatRunFinishStatus = "completed" | "failed" | "aborted";

export interface SetRunFinishedParams {
  readonly runId: string;
  readonly status: ChatRunFinishStatus;
  readonly updatedAt: string;
}

export interface ChatSessionStore {
  createSession(params: CreateSessionParams): Promise<ChatSessionRecord>;

  /** 不存在时返回 null（查询语义），不抛错。 */
  getSession(sessionId: string): Promise<ChatSessionRecord | null>;

  renameSession(params: RenameSessionParams): Promise<ChatSessionRecord>;

  /** 按 (updatedAt DESC, sessionId DESC) 返回最多 limit 条。 */
  listSessions(
    params: ListSessionsParams,
  ): Promise<readonly ChatSessionRecord[]>;

  /** 会话不存在时抛错；存在但无消息时返回空数组。 */
  getMessages(sessionId: string): Promise<readonly ChatMessageRecord[]>;

  /** 不存在时返回 null。 */
  getRun(runId: string): Promise<ChatRunRecord | null>;

  /** 幂等写入：同一 runId 重复调用不重复追加消息，也不重复应用自动标题。 */
  appendUserMessage(
    params: AppendUserMessageParams,
  ): Promise<AppendUserMessageResult>;

  setRunAccepted(params: SetRunAcceptedParams): Promise<ChatRunRecord>;

  setRunCreateFailed(params: SetRunCreateFailedParams): Promise<ChatRunRecord>;

  startAssistantMessage(
    params: StartAssistantMessageParams,
  ): Promise<ChatMessageRecord>;

  appendAssistantDelta(params: AppendAssistantDeltaParams): Promise<void>;

  setRunFinished(params: SetRunFinishedParams): Promise<ChatRunRecord>;
}
