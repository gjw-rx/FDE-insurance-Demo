import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  chatMessage,
  chatRun,
  chatSession,
} from "../../../drizzle/chat-schema.js";
import {
  readErrorCode,
  type MySqlQueryHandle,
} from "../database/mysql-database.js";
import { ChatRequestError } from "../../application/chat/chat-request-error.js";
import { ChatSessionStoreError } from "../../application/chat/chat-session-store-error.js";
import type {
  AppendAssistantDeltaParams,
  AppendUserMessageParams,
  AppendUserMessageResult,
  ChatSessionStore,
  CreateSessionParams,
  ListSessionsParams,
  RecoverInterruptedRunsParams,
  RecoverySummary,
  RenameSessionParams,
  SetRunAcceptedParams,
  SetRunCreateFailedParams,
  SetRunFinishedParams,
  StartAssistantMessageParams,
} from "../../application/chat/chat-session-store.js";
import type {
  ChatMessageRecord,
  ChatRunRecord,
  ChatSessionRecord,
} from "../../application/chat/chat-session-records.js";
import {
  AGENT_RUN_NON_TERMINAL_STATUSES,
  assertWritableMessageStatus,
  assertWritableRunFinishStatus,
  assertWritableRunStatus,
  assertWritableTitleSource,
  isNonTerminalRunStatus,
  parseRunSnapshot,
  readMessageRole,
  readMessageStatus,
  readRunStatus,
  readTitleSource,
} from "./chat-value-validation.js";

/**
 * MySQL 会话仓储。
 *
 * 实现 `ChatSessionStore` 端口，是生产路径的唯一会话存储。设计要点见 change
 * `persist-chat-sessions-with-mysql` 的 design.md：
 *
 * - 所有写入在事务内完成，并用 `select ... for update` 锁定会话行分配
 *   `message_order`，保证同一会话的消息顺序不依赖时间戳或随机 ID。
 * - 幂等由 `(run_id, role)` 唯一键与事务内的存在性检查共同保证；重复提交返回既有
 *   记录，不重复写消息，也不重复触发 Agent。
 * - 终态只收敛一次：更新条件限定在非终态，较早的操作晚返回时不会覆盖较新的状态。
 * - 时间戳由应用层以 UTC 传入，这里负责 ISO 8601 与 MySQL `DATETIME(3)` 字面量的
 *   双向转换；连接池关闭了驱动侧日期解析，避免时区漂移。
 * - 受控取值（标题来源、角色、状态）在写入前校验、读取时校验；库内没有 `ENUM`
 *   也没有取值约束，未知取值一律转为稳定的存储不可用错误，不透传给对外契约。
 *
 * 已知限制：`drizzle-orm` 不提供逐语句查询超时，查询超时依赖连接池的建连超时与
 * 排队上限；驱动错误不向上抛出细节，只按操作名和错误码归类为稳定错误。
 */

/** Drizzle 事务句柄类型，从查询句柄派生，避免依赖驱动内部类型路径。 */
type ChatTransaction = Parameters<
  Parameters<MySqlQueryHandle["transaction"]>[0]
>[0];

type ChatSessionRow = typeof chatSession.$inferSelect;
type ChatMessageRow = typeof chatMessage.$inferSelect;
type ChatRunRow = typeof chatRun.$inferSelect;

/**
 * `chat_run.agent_name` 的占位值。
 *
 * 列是 NOT NULL，而 Agent 名称只在 Agent 接受 run 之后才由快照提供，因此写入 run 时
 * 先置空字符串表示「尚未接受」，`setRunAccepted` 用快照中的真实名称覆盖。该列只用于
 * 诊断，不参与业务判断。
 */
const PENDING_AGENT_NAME = "";

/** 内部状态损坏：run 与它的用户消息或助手消息不成对。 */
class ChatStoreStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatStoreStateError";
  }
}

/** 已归一化的错误直接透出，避免把业务语义重新包装成「服务不可用」。 */
function isNormalizedError(error: unknown): boolean {
  return (
    error instanceof ChatSessionStoreError ||
    error instanceof ChatRequestError ||
    error instanceof ChatStoreStateError
  );
}

/** 把驱动/未知错误映射为稳定的存储不可用错误，只保留操作名与错误码。 */
function unavailable(operation: string, error: unknown): ChatSessionStoreError {
  return new ChatSessionStoreError(
    "CHAT_SESSION_STORE_UNAVAILABLE",
    `${operation}失败（${readErrorCode(error)}）`,
  );
}

/**
 * ISO 8601（UTC）→ MySQL `DATETIME(3)` 字面量。
 *
 * 保存 UTC 挂钟值，不带时区后缀：同一时刻在任何部署时区读出的字面量都相同，
 * 由应用层负责标注 UTC。
 */
export function toMySqlDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new ChatStoreStateError("时间戳不是合法的 ISO 8601 文本");
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
}

/** MySQL `DATETIME(3)` 字面量 → ISO 8601（UTC）。 */
export function fromMySqlDateTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string") {
    throw new ChatSessionStoreError(
      "CHAT_SESSION_STORE_UNAVAILABLE",
      "会话存储中的时间戳类型不在契约内",
    );
  }
  const [datePart, timePart = ""] = value.trim().replace(" ", "T").split("T");
  const [clock, fraction = "000"] = timePart.split(".");
  const millis = fraction.padEnd(3, "0").slice(0, 3);
  const date = new Date(`${datePart ?? ""}T${clock ?? ""}.${millis}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ChatSessionStoreError(
      "CHAT_SESSION_STORE_UNAVAILABLE",
      "会话存储中的时间戳不在契约内",
    );
  }
  return date.toISOString();
}

function toSessionRecord(row: ChatSessionRow): ChatSessionRecord {
  return {
    sessionId: row.sessionId,
    title: row.title,
    titleSource: readTitleSource(row.titleSource),
    createdAt: fromMySqlDateTime(row.createdAt),
    updatedAt: fromMySqlDateTime(row.updatedAt),
  };
}

function toMessageRecord(row: ChatMessageRow): ChatMessageRecord {
  return {
    messageId: row.messageId,
    sessionId: row.sessionId,
    runId: row.runId,
    role: readMessageRole(row.role),
    status: readMessageStatus(row.status),
    text: row.text,
    createdAt: fromMySqlDateTime(row.createdAt),
  };
}

function toRunRecord(row: ChatRunRow): ChatRunRecord {
  const snapshot = parseRunSnapshot(row.snapshotJson);
  return {
    runId: row.runId,
    sessionId: row.sessionId,
    status: readRunStatus(row.status),
    ...(snapshot === undefined ? {} : { snapshot }),
    createdAt: fromMySqlDateTime(row.createdAt),
    updatedAt: fromMySqlDateTime(row.updatedAt),
  };
}

/** 当前会话记录：锁定会话行，不存在即抛出稳定的未找到错误。 */
async function lockSessionRow(
  tx: ChatTransaction,
  sessionId: string,
): Promise<ChatSessionRow> {
  const rows = await tx
    .select()
    .from(chatSession)
    .where(eq(chatSession.sessionId, sessionId))
    .limit(1)
    .for("update");
  const row = rows[0];
  if (row === undefined) {
    throw new ChatSessionStoreError(
      "CHAT_SESSION_NOT_FOUND",
      "指定的会话不存在",
    );
  }
  return row;
}

/** 读取 run 行，不存在即抛出稳定的未找到错误。 */
async function requireRunRow(
  tx: ChatTransaction,
  runId: string,
): Promise<ChatRunRow> {
  const rows = await tx
    .select()
    .from(chatRun)
    .where(eq(chatRun.runId, runId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new ChatSessionStoreError(
      "CHAT_SESSION_NOT_FOUND",
      "指定的会话不存在",
    );
  }
  return row;
}

/** 读取指定 run 与角色的消息行；不存在返回 undefined。 */
async function findMessageRow(
  tx: ChatTransaction,
  runId: string,
  role: "user" | "assistant",
): Promise<ChatMessageRow | undefined> {
  const rows = await tx
    .select()
    .from(chatMessage)
    .where(and(eq(chatMessage.runId, runId), eq(chatMessage.role, role)))
    .limit(1);
  return rows[0];
}

/** 更新会话的最近更新时间与下一个消息序号。 */
async function touchSessionOrder(
  tx: ChatTransaction,
  sessionId: string,
  updatedAt: string,
  nextMessageOrder: number,
): Promise<void> {
  await tx
    .update(chatSession)
    .set({ updatedAt, nextMessageOrder })
    .where(eq(chatSession.sessionId, sessionId));
}

/** 更新会话的最近更新时间（不改变消息序号）。 */
async function touchSession(
  tx: ChatTransaction,
  sessionId: string,
  updatedAt: string,
): Promise<void> {
  await tx
    .update(chatSession)
    .set({ updatedAt })
    .where(eq(chatSession.sessionId, sessionId));
}

/** 更新用户消息状态；不存在时不报错（沿用既有语义）。 */
async function setUserMessageStatus(
  tx: ChatTransaction,
  runId: string,
  status: "accepted" | "send-failed",
): Promise<void> {
  assertWritableMessageStatus(status);
  await tx
    .update(chatMessage)
    .set({ status })
    .where(and(eq(chatMessage.runId, runId), eq(chatMessage.role, "user")));
}

export interface MySqlChatSessionStoreOptions {
  readonly db: MySqlQueryHandle;
}

export class MySqlChatSessionStore implements ChatSessionStore {
  private readonly db: MySqlQueryHandle;

  constructor(options: MySqlChatSessionStoreOptions) {
    this.db = options.db;
  }

  async createSession(params: CreateSessionParams): Promise<ChatSessionRecord> {
    const record: ChatSessionRecord = {
      sessionId: params.sessionId,
      title: params.title,
      titleSource: "default",
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    };
    try {
      await this.db.insert(chatSession).values({
        sessionId: record.sessionId,
        title: record.title,
        titleSource: record.titleSource,
        createdAt: toMySqlDateTime(record.createdAt),
        updatedAt: toMySqlDateTime(record.updatedAt),
        nextMessageOrder: 1,
      });
    } catch (error) {
      // 会话 ID 由应用层用 UUID 生成，重复即程序缺陷，不映射为对外错误码。
      if (readErrorCode(error) === "ER_DUP_ENTRY") {
        throw new Error("会话标识冲突");
      }
      throw unavailable("创建会话", error);
    }
    return record;
  }

  async getSession(sessionId: string): Promise<ChatSessionRecord | null> {
    try {
      const rows = await this.db
        .select()
        .from(chatSession)
        .where(eq(chatSession.sessionId, sessionId))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toSessionRecord(row);
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("读取会话", error);
    }
  }

  async renameSession(params: RenameSessionParams): Promise<ChatSessionRecord> {
    assertWritableTitleSource(params.titleSource);
    try {
      return await this.db.transaction(async (tx) => {
        const current = await lockSessionRow(tx, params.sessionId);
        const updatedAt = toMySqlDateTime(params.updatedAt);
        await tx
          .update(chatSession)
          .set({
            title: params.title,
            titleSource: params.titleSource,
            updatedAt,
          })
          .where(eq(chatSession.sessionId, params.sessionId));
        return {
          ...toSessionRecord(current),
          title: params.title,
          titleSource: params.titleSource,
          updatedAt: fromMySqlDateTime(updatedAt),
        };
      });
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("重命名会话", error);
    }
  }

  async listSessions(
    params: ListSessionsParams,
  ): Promise<readonly ChatSessionRecord[]> {
    const after = params.after;
    const cursorCondition =
      after === undefined
        ? undefined
        : or(
            lt(chatSession.updatedAt, toMySqlDateTime(after.updatedAt)),
            and(
              eq(chatSession.updatedAt, toMySqlDateTime(after.updatedAt)),
              lt(chatSession.sessionId, after.sessionId),
            ),
          );
    try {
      const rows = await this.db
        .select()
        .from(chatSession)
        .where(cursorCondition)
        .orderBy(desc(chatSession.updatedAt), desc(chatSession.sessionId))
        .limit(params.limit);
      return rows.map(toSessionRecord);
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("列出会话", error);
    }
  }

  async getMessages(sessionId: string): Promise<readonly ChatMessageRecord[]> {
    try {
      const session = await this.db
        .select({ sessionId: chatSession.sessionId })
        .from(chatSession)
        .where(eq(chatSession.sessionId, sessionId))
        .limit(1);
      if (session[0] === undefined) {
        throw new ChatSessionStoreError(
          "CHAT_SESSION_NOT_FOUND",
          "指定的会话不存在",
        );
      }
      const rows = await this.db
        .select()
        .from(chatMessage)
        .where(eq(chatMessage.sessionId, sessionId))
        .orderBy(asc(chatMessage.messageOrder));
      return rows.map(toMessageRecord);
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("读取会话消息", error);
    }
  }

  async getRun(runId: string): Promise<ChatRunRecord | null> {
    try {
      const rows = await this.db
        .select()
        .from(chatRun)
        .where(eq(chatRun.runId, runId))
        .limit(1);
      const row = rows[0];
      return row === undefined ? null : toRunRecord(row);
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("读取 run", error);
    }
  }

  async appendUserMessage(
    params: AppendUserMessageParams,
  ): Promise<AppendUserMessageResult> {
    try {
      return await this.db.transaction(
        async (tx) => await this.appendUserMessageInTransaction(tx, params),
      );
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      if (readErrorCode(error) === "ER_DUP_ENTRY") {
        // 并发场景下同一 runId 被不同会话提交：唯一键先于行锁生效，这里按既有
        // 记录重新判定，避免把「非法复用 runId」误报成存储不可用。
        return this.resolveExistingRun(params);
      }
      throw unavailable("写入用户消息", error);
    }
  }

  async setRunAccepted(params: SetRunAcceptedParams): Promise<ChatRunRecord> {
    assertWritableRunStatus(params.snapshot.status);
    try {
      return await this.db.transaction(async (tx) => {
        const current = await requireRunRow(tx, params.runId);
        const updatedAt = toMySqlDateTime(params.updatedAt);
        const status = params.snapshot.status;
        if (!isNonTerminalRunStatus(current.status)) {
          // 已进入终态的 run 不再被较早的接受结果覆盖。
          return toRunRecord(current);
        }
        await tx
          .update(chatRun)
          .set({
            status,
            agentName: params.snapshot.agentName,
            snapshotJson: params.snapshot,
            updatedAt,
            ...(params.snapshot.finishedAt === undefined
              ? {}
              : { finishedAt: toMySqlDateTime(params.snapshot.finishedAt) }),
            ...(params.snapshot.abortReason === undefined
              ? {}
              : { abortReason: params.snapshot.abortReason }),
            ...(params.snapshot.errorCode === undefined
              ? {}
              : { errorCode: params.snapshot.errorCode }),
          })
          .where(eq(chatRun.runId, params.runId));
        await setUserMessageStatus(tx, params.runId, "accepted");
        await touchSession(tx, current.sessionId, updatedAt);
        return {
          ...toRunRecord(current),
          status: readRunStatus(status),
          snapshot: params.snapshot,
          updatedAt: fromMySqlDateTime(updatedAt),
        };
      });
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("记录 run 接受", error);
    }
  }

  async setRunCreateFailed(
    params: SetRunCreateFailedParams,
  ): Promise<ChatRunRecord> {
    try {
      return await this.db.transaction(async (tx) => {
        const current = await requireRunRow(tx, params.runId);
        const updatedAt = toMySqlDateTime(params.updatedAt);
        await tx
          .update(chatRun)
          .set({ status: "failed", updatedAt })
          .where(
            and(
              eq(chatRun.runId, params.runId),
              inArray(chatRun.status, [...AGENT_RUN_NON_TERMINAL_STATUSES]),
            ),
          );
        await setUserMessageStatus(tx, params.runId, "send-failed");
        await touchSession(tx, current.sessionId, updatedAt);
        return {
          ...toRunRecord(current),
          status: readRunStatus("failed"),
          updatedAt: fromMySqlDateTime(updatedAt),
        };
      });
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("记录 run 创建失败", error);
    }
  }

  async startAssistantMessage(
    params: StartAssistantMessageParams,
  ): Promise<ChatMessageRecord> {
    try {
      return await this.db.transaction(async (tx) => {
        const run = await requireRunRow(tx, params.runId);
        const existing = await findMessageRow(tx, params.runId, "assistant");
        if (existing !== undefined) return toMessageRecord(existing);

        const session = await lockSessionRow(tx, run.sessionId);
        const messageOrder = session.nextMessageOrder;
        const createdAt = toMySqlDateTime(params.createdAt);
        const record = {
          messageId: params.messageId,
          sessionId: run.sessionId,
          runId: params.runId,
          role: "assistant" as const,
          status: "streaming" as const,
          text: "",
          createdAt: fromMySqlDateTime(createdAt),
        };
        assertWritableMessageStatus(record.status);
        await tx.insert(chatMessage).values({
          messageId: record.messageId,
          sessionId: record.sessionId,
          runId: record.runId,
          messageOrder,
          role: record.role,
          status: record.status,
          text: record.text,
          createdAt,
        });
        await touchSessionOrder(tx, run.sessionId, createdAt, messageOrder + 1);
        return record;
      });
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("创建助手消息", error);
    }
  }

  async appendAssistantDelta(
    params: AppendAssistantDeltaParams,
  ): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const run = await requireRunRow(tx, params.runId);
        const existing = await findMessageRow(tx, params.runId, "assistant");
        if (existing === undefined) {
          // 首个增量会先创建助手消息，因此不存在「有增量但没有助手消息」的稳定状态。
          throw new ChatStoreStateError("run 缺少助手消息");
        }
        const updatedAt = toMySqlDateTime(params.updatedAt);
        await tx
          .update(chatMessage)
          .set({ text: sql`concat(${chatMessage.text}, ${params.text})` })
          .where(eq(chatMessage.messageId, existing.messageId));
        await touchSession(tx, run.sessionId, updatedAt);
      });
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("追加回答增量", error);
    }
  }

  async setRunFinished(params: SetRunFinishedParams): Promise<ChatRunRecord> {
    assertWritableRunFinishStatus(params.status);
    try {
      return await this.db.transaction(async (tx) => {
        const current = await requireRunRow(tx, params.runId);
        const updatedAt = toMySqlDateTime(params.updatedAt);
        if (!isNonTerminalRunStatus(current.status)) {
          // 终态只收敛一次：重复或迟到的终态写入不改变既有结果。
          return toRunRecord(current);
        }
        await tx
          .update(chatRun)
          .set({ status: params.status, updatedAt, finishedAt: updatedAt })
          .where(eq(chatRun.runId, params.runId));
        const assistant = await findMessageRow(tx, params.runId, "assistant");
        if (assistant !== undefined) {
          const messageStatus =
            params.status === "completed" ? "completed" : "failed";
          await tx
            .update(chatMessage)
            .set({ status: messageStatus })
            .where(eq(chatMessage.messageId, assistant.messageId));
        }
        await touchSession(tx, current.sessionId, updatedAt);
        return {
          ...toRunRecord(current),
          status: readRunStatus(params.status),
          updatedAt: fromMySqlDateTime(updatedAt),
        };
      });
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("收敛 run 终态", error);
    }
  }

  /**
   * 重启恢复：把遗留的非终态 run 与 `streaming` 助手消息收敛为失败。
   *
   * 只更新非终态记录，因此重复执行不会产生新变化；不重新启动 Agent，也不修改
   * 会话的最近更新时间，避免重启把历史列表顺序打乱。
   */
  async recoverInterruptedRuns(
    params: RecoverInterruptedRunsParams,
  ): Promise<RecoverySummary> {
    try {
      const recoveredAt = toMySqlDateTime(params.updatedAt);
      return await this.db.transaction(async (tx) => {
        const runs = await tx
          .update(chatRun)
          .set({
            status: "failed",
            updatedAt: recoveredAt,
            finishedAt: recoveredAt,
          })
          .where(inArray(chatRun.status, [...AGENT_RUN_NON_TERMINAL_STATUSES]));
        const messages = await tx
          .update(chatMessage)
          .set({ status: "failed" })
          .where(eq(chatMessage.status, "streaming"));
        return {
          runs: runs[0].affectedRows,
          messages: messages[0].affectedRows,
        };
      });
    } catch (error) {
      if (isNormalizedError(error)) throw error;
      throw unavailable("重启恢复", error);
    }
  }

  /** 事务内实现：先锁定会话行，再按 runId 幂等写入用户消息与 run。 */
  private async appendUserMessageInTransaction(
    tx: ChatTransaction,
    params: AppendUserMessageParams,
  ): Promise<AppendUserMessageResult> {
    const session = await lockSessionRow(tx, params.sessionId);

    const existingRun = await tx
      .select()
      .from(chatRun)
      .where(eq(chatRun.runId, params.runId))
      .limit(1);
    const runRow = existingRun[0];
    if (runRow !== undefined) {
      if (runRow.sessionId !== params.sessionId) {
        // runId 全局唯一：跨会话复用属于非法请求（400），而不是可重试的服务故障。
        throw new ChatRequestError("runId 已被其他会话使用");
      }
      const messageRow = await findMessageRow(tx, params.runId, "user");
      if (messageRow === undefined) {
        throw new ChatStoreStateError("run 记录缺少对应用户消息");
      }
      return {
        created: false,
        session: toSessionRecord(session),
        message: toMessageRecord(messageRow),
        run: toRunRecord(runRow),
      };
    }

    const messageOrder = session.nextMessageOrder;
    const createdAt = toMySqlDateTime(params.createdAt);
    const message: ChatMessageRecord = {
      messageId: params.messageId,
      sessionId: params.sessionId,
      runId: params.runId,
      role: "user",
      status: "accepted",
      text: params.text,
      createdAt: fromMySqlDateTime(createdAt),
    };
    assertWritableMessageStatus(message.status);
    await tx.insert(chatRun).values({
      runId: params.runId,
      sessionId: params.sessionId,
      agentName: PENDING_AGENT_NAME,
      status: "accepted",
      snapshotJson: null,
      createdAt,
      updatedAt: createdAt,
    });
    await tx.insert(chatMessage).values({
      messageId: message.messageId,
      sessionId: message.sessionId,
      runId: message.runId,
      messageOrder,
      role: message.role,
      status: message.status,
      text: message.text,
      createdAt,
    });

    // 自动标题与用户消息写入同一步完成：仅当会话仍是默认标题时生效，
    // 因此手动重命名后到达的首条消息不会覆盖用户设置的标题。
    const appliesAutoTitle =
      session.titleSource === "default" && params.autoTitle !== undefined;
    const nextTitle = appliesAutoTitle ? params.autoTitle : session.title;
    const nextTitleSource = appliesAutoTitle
      ? "first-message"
      : session.titleSource;
    assertWritableTitleSource(nextTitleSource);
    await tx
      .update(chatSession)
      .set({
        title: nextTitle ?? session.title,
        titleSource: nextTitleSource,
        updatedAt: createdAt,
        nextMessageOrder: messageOrder + 1,
      })
      .where(eq(chatSession.sessionId, params.sessionId));

    const run: ChatRunRecord = {
      runId: params.runId,
      sessionId: params.sessionId,
      status: "accepted",
      createdAt: fromMySqlDateTime(createdAt),
      updatedAt: fromMySqlDateTime(createdAt),
    };
    const updatedSession: ChatSessionRecord = {
      ...toSessionRecord(session),
      title: nextTitle ?? session.title,
      titleSource: readTitleSource(nextTitleSource),
      updatedAt: fromMySqlDateTime(createdAt),
    };
    return { created: true, session: updatedSession, message, run };
  }

  /** 唯一键冲突后按既有记录重新判定 runId 是否被跨会话复用。 */
  private async resolveExistingRun(
    params: AppendUserMessageParams,
  ): Promise<AppendUserMessageResult> {
    const run = await this.getRun(params.runId);
    if (run === null) throw unavailable("写入用户消息", new Error("retry"));
    if (run.sessionId !== params.sessionId) {
      throw new ChatRequestError("runId 已被其他会话使用");
    }
    const session = await this.getSession(params.sessionId);
    if (session === null) {
      throw new ChatSessionStoreError(
        "CHAT_SESSION_NOT_FOUND",
        "指定的会话不存在",
      );
    }
    const messages = await this.getMessages(params.sessionId);
    const message = messages.find(
      (candidate) =>
        candidate.runId === params.runId && candidate.role === "user",
    );
    if (message === undefined) {
      throw new ChatStoreStateError("run 记录缺少对应用户消息");
    }
    return { created: false, session, message, run };
  }
}
