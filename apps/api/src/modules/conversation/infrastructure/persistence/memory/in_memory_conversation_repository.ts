import type {
  AppendAssistantDeltaParams,
  AppendUserMessageParams,
  AppendUserMessageResult,
  ChatSessionStore,
  CreateSessionParams,
  FinalizeAssistantAnswerParams,
  ListSessionsParams,
  RecoverInterruptedRunsParams,
  RecoverySummary,
  RenameSessionParams,
  SetRunAcceptedParams,
  SetRunCreateFailedParams,
  SetRunFinishedParams,
  StartAssistantMessageParams,
} from "../../../application/ports/conversation_repository.js";
import type {
  ChatMessageRecord,
  ChatRunRecord,
  ChatSessionRecord,
} from "../../../application/read_models/session_records.js";
import { ChatRequestError } from "../../../application/errors/request_error.js";
import { ChatSessionStoreError } from "../../../application/errors/store_error.js";

/**
 * 进程内会话仓储（测试与本地替身）。
 *
 * 生产路径使用 `MySqlChatSessionStore`；本实现只用于测试、本地替身与不需要持久化的
 * 场景：数据随进程退出即丢失，不跨重启恢复。它实现同一个 `ChatSessionStore` 端口，
 * 因此应用服务、路由与前端契约不区分两者。
 *
 * 实现约定：
 * - 所有方法都是同步内存操作，天然按调用顺序串行，不存在并发写冲突。
 * - 读方法返回浅拷贝，调用方无法通过返回值篡改内部状态。
 * - 会话排序键为 (updatedAt DESC, sessionId DESC)；消息顺序即写入顺序。
 */
export class InMemoryChatSessionStore implements ChatSessionStore {
  private readonly sessions = new Map<string, ChatSessionRecord>();
  private readonly messages = new Map<string, ChatMessageRecord[]>();
  private readonly runs = new Map<string, ChatRunRecord>();

  async createSession(params: CreateSessionParams): Promise<ChatSessionRecord> {
    // 会话 ID 由应用层用 UUID 生成，重复即程序缺陷，不映射为对外错误码。
    if (this.sessions.has(params.sessionId)) {
      throw new Error("会话标识冲突");
    }
    const session: ChatSessionRecord = {
      sessionId: params.sessionId,
      title: params.title,
      titleSource: "default",
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    };
    this.sessions.set(session.sessionId, session);
    this.messages.set(session.sessionId, []);
    return session;
  }

  async getSession(sessionId: string): Promise<ChatSessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async renameSession(params: RenameSessionParams): Promise<ChatSessionRecord> {
    const session = this.requireSession(params.sessionId);
    const updated: ChatSessionRecord = {
      ...session,
      title: params.title,
      titleSource: params.titleSource,
      updatedAt: params.updatedAt,
    };
    this.sessions.set(updated.sessionId, updated);
    return updated;
  }

  async listSessions(
    params: ListSessionsParams,
  ): Promise<readonly ChatSessionRecord[]> {
    const ordered = [...this.sessions.values()].sort(compareSessions);
    const after = params.after;
    const start =
      after === undefined
        ? ordered
        : ordered.filter((record) => compareSessions(record, after) > 0);
    return start.slice(0, params.limit).map((record) => ({ ...record }));
  }

  async getMessages(sessionId: string): Promise<readonly ChatMessageRecord[]> {
    this.requireSession(sessionId);
    return this.listMessages(sessionId).map((message) => ({ ...message }));
  }

  async getRun(runId: string): Promise<ChatRunRecord | null> {
    const run = this.runs.get(runId);
    return run === undefined ? null : { ...run };
  }

  async appendUserMessage(
    params: AppendUserMessageParams,
  ): Promise<AppendUserMessageResult> {
    const session = this.requireSession(params.sessionId);
    const existing = this.runs.get(params.runId);
    if (existing !== undefined) {
      if (existing.sessionId !== params.sessionId) {
        // runId 全局唯一：跨会话复用属于非法请求（400），而不是可重试的服务故障。
        throw new ChatRequestError("runId 已被其他会话使用");
      }
      const message = this.listMessages(params.sessionId).find(
        (candidate) =>
          candidate.runId === params.runId && candidate.role === "user",
      );
      if (message === undefined) {
        // run 与用户消息必须成对写入，缺一即为内部状态损坏。
        throw new Error("run 记录缺少对应用户消息");
      }
      return {
        created: false,
        session,
        message: { ...message },
        run: { ...existing },
      };
    }

    const message: ChatMessageRecord = {
      messageId: params.messageId,
      sessionId: params.sessionId,
      runId: params.runId,
      role: "user",
      status: "accepted",
      text: params.text,
      createdAt: params.createdAt,
    };
    this.listMessages(params.sessionId).push(message);

    const run: ChatRunRecord = {
      runId: params.runId,
      sessionId: params.sessionId,
      status: "accepted",
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    };
    this.runs.set(run.runId, run);

    // 自动标题与用户消息写入同一步完成：仅当会话仍是默认标题时生效，
    // 因此手动重命名后到达的首条消息不会覆盖用户设置的标题。
    const updatedSession: ChatSessionRecord = {
      ...session,
      updatedAt: params.createdAt,
      ...(session.titleSource === "default" && params.autoTitle !== undefined
        ? { title: params.autoTitle, titleSource: "first-message" as const }
        : {}),
    };
    this.sessions.set(updatedSession.sessionId, updatedSession);

    return {
      created: true,
      session: updatedSession,
      message: { ...message },
      run: { ...run },
    };
  }

  async setRunAccepted(params: SetRunAcceptedParams): Promise<ChatRunRecord> {
    const run = this.requireRun(params.runId);
    const updated: ChatRunRecord = {
      ...run,
      status: params.snapshot.status,
      snapshot: params.snapshot,
      updatedAt: params.updatedAt,
    };
    this.runs.set(updated.runId, updated);
    this.updateUserMessageStatus(updated.sessionId, params.runId, "accepted");
    this.touchSession(updated.sessionId, params.updatedAt);
    return { ...updated };
  }

  async setRunCreateFailed(
    params: SetRunCreateFailedParams,
  ): Promise<ChatRunRecord> {
    const run = this.requireRun(params.runId);
    const updated: ChatRunRecord = {
      ...run,
      status: "failed",
      updatedAt: params.updatedAt,
    };
    this.runs.set(updated.runId, updated);
    // 保留用户消息但标记发送失败，避免用户输入被静默丢弃。
    this.updateUserMessageStatus(
      updated.sessionId,
      params.runId,
      "send-failed",
    );
    this.touchSession(updated.sessionId, params.updatedAt);
    return { ...updated };
  }

  async startAssistantMessage(
    params: StartAssistantMessageParams,
  ): Promise<ChatMessageRecord> {
    const run = this.requireRun(params.runId);
    const message: ChatMessageRecord = {
      messageId: params.messageId,
      sessionId: run.sessionId,
      runId: run.runId,
      role: "assistant",
      status: "streaming",
      text: "",
      createdAt: params.createdAt,
    };
    this.listMessages(run.sessionId).push(message);
    return { ...message };
  }

  async appendAssistantDelta(
    params: AppendAssistantDeltaParams,
  ): Promise<void> {
    const run = this.requireRun(params.runId);
    const list = this.listMessages(run.sessionId);
    const index = list.findIndex(
      (message) =>
        message.runId === params.runId && message.role === "assistant",
    );
    if (index === -1) {
      // 首个增量创建助手消息，因此不存在「有增量但没有助手消息」的稳定状态。
      throw new Error("run 缺少助手消息");
    }
    const current = list[index];
    if (current === undefined) {
      throw new Error("run 缺少助手消息");
    }
    list[index] = { ...current, text: current.text + params.text };
    this.touchSession(run.sessionId, params.updatedAt);
  }

  async finalizeAssistantAnswer(
    params: FinalizeAssistantAnswerParams,
  ): Promise<ChatRunRecord> {
    const run = this.requireRun(params.runId);
    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "aborted"
    ) {
      return { ...run };
    }
    const list = this.listMessages(run.sessionId);
    const existing = list.find(
      (message) =>
        message.runId === params.runId && message.role === "assistant",
    );
    const messageStatus =
      params.status === "completed" ? "completed" : "failed";
    if (params.text.length > 0 || existing !== undefined) {
      const message: ChatMessageRecord = {
        messageId: existing?.messageId ?? params.messageId,
        sessionId: run.sessionId,
        runId: run.runId,
        role: "assistant",
        status: messageStatus,
        text: params.text,
        createdAt: existing?.createdAt ?? params.createdAt,
      };
      if (existing === undefined) list.push(message);
      else list[list.indexOf(existing)] = message;
    }
    const updated: ChatRunRecord = {
      ...run,
      status: params.status,
      updatedAt: params.updatedAt,
    };
    this.runs.set(updated.runId, updated);
    this.touchSession(updated.sessionId, params.updatedAt);
    return { ...updated };
  }

  async setRunFinished(params: SetRunFinishedParams): Promise<ChatRunRecord> {
    const run = this.requireRun(params.runId);
    const updated: ChatRunRecord = {
      ...run,
      status: params.status,
      updatedAt: params.updatedAt,
    };
    this.runs.set(updated.runId, updated);

    const list = this.listMessages(updated.sessionId);
    const index = list.findIndex(
      (message) =>
        message.runId === params.runId && message.role === "assistant",
    );
    if (index !== -1) {
      const current = list[index];
      if (current !== undefined) {
        list[index] = {
          ...current,
          status: params.status === "completed" ? "completed" : "failed",
        };
      }
    }
    this.touchSession(updated.sessionId, params.updatedAt);
    return { ...updated };
  }

  /**
   * 重启恢复：进程内没有跨重启状态，因此没有需要收敛的记录。
   *
   * 返回零值而不是抛错，让调用方对两种实现使用同一套生命周期代码。
   */
  async recoverInterruptedRuns(
    _params: RecoverInterruptedRunsParams,
  ): Promise<RecoverySummary> {
    return { runs: 0, messages: 0 };
  }

  /** 返回可变的会话消息数组（内部使用）。 */
  private listMessages(sessionId: string): ChatMessageRecord[] {
    const list = this.messages.get(sessionId);
    if (list === undefined) {
      throw new ChatSessionStoreError(
        "CHAT_SESSION_NOT_FOUND",
        "指定的会话不存在",
      );
    }
    return list;
  }

  private requireSession(sessionId: string): ChatSessionRecord {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new ChatSessionStoreError(
        "CHAT_SESSION_NOT_FOUND",
        "指定的会话不存在",
      );
    }
    return session;
  }

  private requireRun(runId: string): ChatRunRecord {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new ChatSessionStoreError(
        "CHAT_SESSION_NOT_FOUND",
        "指定的会话不存在",
      );
    }
    return run;
  }

  private updateUserMessageStatus(
    sessionId: string,
    runId: string,
    status: ChatMessageRecord["status"],
  ): void {
    const list = this.listMessages(sessionId);
    const index = list.findIndex(
      (message) => message.runId === runId && message.role === "user",
    );
    if (index === -1) return;
    const current = list[index];
    if (current === undefined) return;
    list[index] = { ...current, status };
  }

  private touchSession(sessionId: string, updatedAt: string): void {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    this.sessions.set(sessionId, { ...session, updatedAt });
  }
}

/**
 * 会话排序：最近更新在前；同一时间戳用 sessionId 倒序作为稳定次序，
 * 保证分页在两次请求之间不会重复或跳过条目。
 */
function compareSessions(
  a:
    | ChatSessionRecord
    | { readonly updatedAt: string; readonly sessionId: string },
  b:
    | ChatSessionRecord
    | { readonly updatedAt: string; readonly sessionId: string },
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? 1 : -1;
  return 0;
}
