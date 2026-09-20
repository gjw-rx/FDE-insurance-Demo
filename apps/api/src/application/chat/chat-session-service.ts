import {
  CHAT_SESSION_PAGE_SIZE_DEFAULT,
  CHAT_SESSION_PAGE_SIZE_MAX,
  CHAT_SESSION_TITLE_MAX_LENGTH,
  DEFAULT_CHAT_SESSION_TITLE,
  type AgentRunSnapshot,
  type ChatMessage,
  type ChatSessionDetailResponse,
  type ChatSessionListResponse,
  type ChatSessionResponse,
  type ChatSessionSummary,
} from "@renewal/contracts";
import { ChatRequestError } from "./chat-request-error.js";
import type {
  ChatMessageRecord,
  ChatRunRecord,
  ChatSessionCursor,
  ChatSessionRecord,
} from "./chat-session-records.js";
import type {
  ChatRunFinishStatus,
  ChatSessionStore,
} from "./chat-session-store.js";
import { ChatSessionStoreError } from "./chat-session-store-error.js";
import {
  deriveTitleFromMessage,
  validateRenamedTitle,
} from "./chat-session-title.js";

/**
 * 会话应用服务。
 *
 * 负责把仓储记录转换为契约 DTO、校验并编解码分页游标、生成 ID 与时间戳，以及编排
 * 「用户消息 + run 记录 + 自动标题」的一致性写入。HTTP 层只做协议适配、仓储只做
 * 存储，因此会话规则（默认标题、自动命名、状态流转）集中在本文件。
 */

export interface ChatSessionServiceOptions {
  readonly store: ChatSessionStore;
  /** 时间源；测试注入固定时钟以获得确定性。 */
  readonly now?: () => Date;
  /** ID 生成器；测试注入可预测序列。 */
  readonly newId?: () => string;
}

/** 开始一次 run 的入参（来自已校验的公开请求）。 */
export interface BeginUserMessageParams {
  readonly sessionId: string;
  readonly runId: string;
  readonly message: string;
}

/** 开始一次 run 的结果。 */
export interface BeginUserMessageResult {
  /** false 表示该 runId 已存在，本次未重复写入消息。 */
  readonly created: boolean;
  readonly run: ChatRunRecord;
  readonly session: ChatSessionRecord;
  /** 本次关联的用户消息；重复 runId 时返回既有消息。 */
  readonly message: ChatMessageRecord;
}

/** 会话列表的原始查询参数（尚未校验）。 */
export interface ListSessionsQuery {
  readonly limit: unknown;
  readonly cursor: unknown;
}

const MAX_ID_LENGTH = 128;

/** 校验非空且不过长的标识符。 */
function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

/** 游标编码：把排序键序列化为不透明字符串，客户端不得解析其内容。 */
function encodeCursor(record: ChatSessionRecord): string {
  return Buffer.from(
    JSON.stringify({ u: record.updatedAt, i: record.sessionId }),
    "utf8",
  ).toString("base64url");
}

/** 游标解码；格式非法时抛出稳定的输入错误，不泄露内部结构。 */
function decodeCursor(raw: string): ChatSessionCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ChatRequestError("cursor 格式非法");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ChatRequestError("cursor 格式非法");
  }
  const record = parsed as Record<string, unknown>;
  const updatedAt = record["u"];
  const sessionId = record["i"];
  if (
    typeof updatedAt !== "string" ||
    updatedAt.length === 0 ||
    typeof sessionId !== "string" ||
    sessionId.length === 0
  ) {
    throw new ChatRequestError("cursor 格式非法");
  }
  return { updatedAt, sessionId };
}

/** 解析分页大小；缺省用默认值，非法直接拒绝而不是静默截断。 */
function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") {
    return CHAT_SESSION_PAGE_SIZE_DEFAULT;
  }
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > CHAT_SESSION_PAGE_SIZE_MAX
  ) {
    throw new ChatRequestError(
      `limit 必须是 1-${CHAT_SESSION_PAGE_SIZE_MAX} 之间的整数`,
    );
  }
  return value;
}

/** 解析游标；缺省表示从最新一条开始。 */
function parseCursor(raw: unknown): ChatSessionCursor | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string")
    throw new ChatRequestError("cursor 必须是字符串");
  return decodeCursor(raw);
}

/** 仓储记录 → 契约摘要。 */
function toSummary(record: ChatSessionRecord): ChatSessionSummary {
  return {
    sessionId: record.sessionId,
    title: record.title,
    titleSource: record.titleSource,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 仓储记录 → 契约消息。 */
function toMessage(record: ChatMessageRecord): ChatMessage {
  return {
    messageId: record.messageId,
    sessionId: record.sessionId,
    runId: record.runId,
    role: record.role,
    status: record.status,
    text: record.text,
    createdAt: record.createdAt,
  };
}

/** 校验重命名请求体；只接受 title 字段，非法输入抛出稳定的输入错误。 */
function readRenameTitle(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ChatRequestError("请求体必须是对象");
  }
  const title = validateRenamedTitle(
    (body as Record<string, unknown>)["title"],
  );
  if (title === null) {
    throw new ChatRequestError(
      `title 必须是 1-${CHAT_SESSION_TITLE_MAX_LENGTH} 个字符的非空文本`,
    );
  }
  return title;
}

export class ChatSessionService {
  private readonly store: ChatSessionStore;
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(options: ChatSessionServiceOptions) {
    this.store = options.store;
    this.clock = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** 新建会话：默认标题、无消息，创建后即可作为当前会话使用。 */
  async createSession(): Promise<ChatSessionResponse> {
    const now = this.clock().toISOString();
    const session = await this.store.createSession({
      sessionId: this.newId(),
      title: DEFAULT_CHAT_SESSION_TITLE,
      createdAt: now,
    });
    return { session: toSummary(session) };
  }

  /** 分页列出会话；按最近更新时间倒序。 */
  async listSessions(
    query: ListSessionsQuery,
  ): Promise<ChatSessionListResponse> {
    const limit = parseLimit(query.limit);
    const after = parseCursor(query.cursor);
    const records = await this.store.listSessions({
      // 多取一条用于判断是否还有下一页，避免额外的计数查询。
      limit: limit + 1,
      ...(after === undefined ? {} : { after }),
    });
    const page = records.slice(0, limit);
    const last = page[page.length - 1];
    return {
      sessions: page.map(toSummary),
      ...(records.length > limit && last !== undefined
        ? { nextCursor: encodeCursor(last) }
        : {}),
    };
  }

  /** 读取会话详情：摘要 + 按存储顺序返回的消息。 */
  async getSessionDetail(
    sessionId: string,
  ): Promise<ChatSessionDetailResponse> {
    if (!isValidId(sessionId)) {
      throw new ChatRequestError("sessionId 格式非法");
    }
    const session = await this.requireSession(sessionId);
    const messages = await this.store.getMessages(sessionId);
    return { session: toSummary(session), messages: messages.map(toMessage) };
  }

  /** 手动重命名：拒绝空标题与超长标题，成功后标题来源变为 manual。 */
  async renameSession(
    sessionId: string,
    body: unknown,
  ): Promise<ChatSessionResponse> {
    if (!isValidId(sessionId)) {
      throw new ChatRequestError("sessionId 格式非法");
    }
    const title = readRenameTitle(body);
    const session = await this.store.renameSession({
      sessionId,
      title,
      titleSource: "manual",
      updatedAt: this.clock().toISOString(),
    });
    return { session: toSummary(session) };
  }

  /**
   * 幂等写入用户消息并建立 run 记录。
   *
   * 会话仍为默认标题时，同一次写入内应用首条消息自动命名，避免出现
   * 「消息已保存但标题未更新」的中间状态。
   */
  async beginUserMessage(
    params: BeginUserMessageParams,
  ): Promise<BeginUserMessageResult> {
    const { sessionId, runId, message } = params;
    const session = await this.requireSession(sessionId);
    const autoTitle =
      session.titleSource === "default"
        ? deriveTitleFromMessage(message)
        : null;
    return this.store.appendUserMessage({
      sessionId,
      runId,
      messageId: this.newId(),
      text: message,
      createdAt: this.clock().toISOString(),
      ...(autoTitle === null ? {} : { autoTitle }),
    });
  }

  /** 记录 Agent 已接受 run，并把用户消息确认为已接受。 */
  async markRunAccepted(params: {
    readonly runId: string;
    readonly snapshot: AgentRunSnapshot;
  }): Promise<ChatRunRecord> {
    return this.store.setRunAccepted({
      runId: params.runId,
      snapshot: params.snapshot,
      updatedAt: this.clock().toISOString(),
    });
  }

  /** 记录 Agent 拒绝创建 run：保留用户消息并标记发送失败。 */
  async markRunCreateFailed(runId: string): Promise<ChatRunRecord> {
    return this.store.setRunCreateFailed({
      runId,
      updatedAt: this.clock().toISOString(),
    });
  }

  /**
   * 创建助手消息（首个回答增量到达时调用）。
   *
   * 不在 run 创建时就建空助手消息，是为了避免「Agent 尚未回答就出现空气泡」，
   * 也保证没有增量直接失败的 run 不会留下空消息。
   */
  async startAssistantAnswer(runId: string): Promise<void> {
    await this.store.startAssistantMessage({
      runId,
      messageId: this.newId(),
      createdAt: this.clock().toISOString(),
    });
  }

  /** 追加回答增量；首个增量会创建助手消息。 */
  async appendAnswerDelta(params: {
    readonly runId: string;
    readonly text: string;
  }): Promise<void> {
    await this.store.appendAssistantDelta({
      runId: params.runId,
      text: params.text,
      updatedAt: this.clock().toISOString(),
    });
  }

  /** 收敛 run 终态，并同步助手消息状态。 */
  async finishRun(params: {
    readonly runId: string;
    readonly status: ChatRunFinishStatus;
  }): Promise<void> {
    await this.store.setRunFinished({
      runId: params.runId,
      status: params.status,
      updatedAt: this.clock().toISOString(),
    });
  }

  /** 读取 run 记录；不存在返回 null。 */
  async findRun(runId: string): Promise<ChatRunRecord | null> {
    return this.store.getRun(runId);
  }

  /** 生成新的消息 ID（协调器创建助手消息时使用）。 */
  nextMessageId(): string {
    return this.newId();
  }

  /** 读取会话；不存在时抛出稳定的未找到错误。 */
  private async requireSession(sessionId: string): Promise<ChatSessionRecord> {
    const session = await this.store.getSession(sessionId);
    if (session === null) {
      throw new ChatSessionStoreError(
        "CHAT_SESSION_NOT_FOUND",
        "指定的会话不存在",
      );
    }
    return session;
  }
}
