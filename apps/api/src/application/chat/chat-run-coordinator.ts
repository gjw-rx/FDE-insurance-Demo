import type {
  AgentRunCreateRequest,
  AgentRunEvent,
  AgentRunSnapshot,
} from "@renewal/contracts";
import type { ChatLogger } from "./chat-logger.js";
import { ChatServiceClosedError } from "./chat-service-closed-error.js";
import type { ChatRunFinishStatus } from "./chat-session-store.js";
import type { ChatSessionService } from "./chat-session-service.js";

/**
 * run 协调器。
 *
 * 浏览器只订阅本协调器，由协调器持有对 `insurance-agent` 的唯一上游订阅：
 * 这样浏览器中途离开不会中断 Agent run，服务端仍能消费到终态并把回答写入会话
 * （见 change design.md D6）。协调器同时负责 run 幂等、终态收敛和内存回收。
 *
 * 边界：
 * - 只消费稳定事件类型；`answer.delta` 之外的增量信息不写入会话。
 * - 不解析回答文本，也不据其推断报价、核保等业务状态。
 * - 日志只记录 runId/sessionId 与稳定状态码，不记录回答正文。
 */

/** 协调器依赖的 Agent 端口；`AgentServiceClient` 结构上满足该接口。 */
export interface ChatRunAgentClient {
  createRun(request: AgentRunCreateRequest): Promise<AgentRunSnapshot>;
  streamEvents(runId: string): AsyncGenerator<AgentRunEvent>;
}

export interface ChatRunCoordinatorOptions {
  readonly sessions: ChatSessionService;
  readonly agentClient: ChatRunAgentClient;
  readonly logger?: ChatLogger;
  /** 时间源；测试可注入以控制过期判断。 */
  readonly now?: () => number;
  /** 终态 run 的事件保留时长，超时后不再可订阅。 */
  readonly retentionMs?: number;
  /** 同时保留的 run 上限，避免内存无界增长。 */
  readonly maxRetainedRuns?: number;
  /** 优雅关闭时等待活动 run 收敛的最长时间。 */
  readonly shutdownTimeoutMs?: number;
}

/** 开始一次 run 的入参。 */
export interface ChatRunStartParams {
  readonly sessionId: string;
  readonly runId: string;
  readonly message: string;
}

/**
 * 浏览器侧订阅句柄。
 *
 * 从该 run 的第一个事件开始按顺序回放，并在终态事件之后返回 null；
 * `close()` 只解除本订阅，不影响后台消费。
 */
export interface ChatRunSubscription {
  next(): Promise<AgentRunEvent | null>;
  close(): void;
}

/** 订阅了本进程未创建的 run。 */
export class ChatRunNotFoundError extends Error {
  readonly code = "RUN_NOT_FOUND" as const;

  constructor() {
    super("指定的 run 不存在或已过期");
    this.name = "ChatRunNotFoundError";
  }
}

/** 上游 Agent 稳定拒绝：SSE 空流时回放给订阅者，避免丢失错误码保真度。 */
export interface ChatRunUpstreamRejection {
  /** Agent 稳定错误码（`ChatApiErrorCode` 的子集字面量）。 */
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
}

/** 上游 Agent 稳定拒绝错误的结构形状；结构化匹配以避免应用层依赖基础设施类型。 */
interface AgentServiceRejectionError {
  readonly kind: unknown;
  readonly statusCode?: unknown;
  readonly serviceError?: {
    readonly code?: unknown;
    readonly retryable?: unknown;
  };
}

/** 提取 Agent 稳定服务拒绝（错误码 + retryable + 状态码）；非该形状返回 undefined。 */
function toUpstreamRejection(
  error: unknown,
): ChatRunUpstreamRejection | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as AgentServiceRejectionError;
  const serviceError = candidate.serviceError;
  if (
    candidate.kind === "service" &&
    typeof serviceError?.code === "string" &&
    typeof serviceError.retryable === "boolean"
  ) {
    return {
      code: serviceError.code,
      retryable: serviceError.retryable,
      ...(typeof candidate.statusCode === "number"
        ? { statusCode: candidate.statusCode }
        : {}),
    };
  }
  return undefined;
}

const DEFAULT_RETENTION_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_RETAINED_RUNS = 200;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

/** 终态事件判定，从契约类型派生集合。 */
function isTerminalEvent(event: AgentRunEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.aborted"
  );
}

/** 终态事件 → 会话 run 状态。 */
function toFinishStatus(event: AgentRunEvent): ChatRunFinishStatus {
  if (event.type === "run.completed") return "completed";
  if (event.type === "run.aborted") return "aborted";
  return "failed";
}

/** 单个 run 的事件通道：保存已产生事件并通知订阅者。 */
class RunChannel {
  readonly runId: string;
  readonly createdAt: number;
  readonly events: AgentRunEvent[] = [];
  private readonly listeners = new Set<() => void>();
  private terminal = false;
  private terminalAt: number | undefined;
  private rejection: ChatRunUpstreamRejection | undefined;

  constructor(runId: string, createdAt: number) {
    this.runId = runId;
    this.createdAt = createdAt;
  }

  get finished(): boolean {
    return this.terminal;
  }

  get finishedAt(): number | undefined {
    return this.terminalAt;
  }

  /** 无终态结束时的上游稳定拒绝；未记录（上游静默结束/进程关闭）为 undefined。 */
  get rejectedWith(): ChatRunUpstreamRejection | undefined {
    return this.rejection;
  }

  publish(event: AgentRunEvent, now: number): void {
    this.events.push(event);
    if (isTerminalEvent(event)) {
      this.terminal = true;
      this.terminalAt ??= now;
    }
    this.notify();
  }

  /** 无终态结束（上游中断或进程停止）：让订阅者结束等待而不是永久挂起。 */
  finish(now: number, rejection?: ChatRunUpstreamRejection): void {
    if (rejection !== undefined) this.rejection ??= rejection;
    this.terminal = true;
    this.terminalAt ??= now;
    this.notify();
  }

  subscribe(): ChatRunSubscription {
    let index = 0;
    let closed = false;
    let waiter: ((value: AgentRunEvent | null) => void) | null = null;

    const flush = (): void => {
      if (closed || waiter === null) return;
      if (index < this.events.length) {
        const event = this.events[index];
        index += 1;
        if (event === undefined) return;
        const resolve = waiter;
        waiter = null;
        resolve(event);
        return;
      }
      if (this.terminal) {
        const resolve = waiter;
        waiter = null;
        resolve(null);
      }
    };

    const listener = (): void => flush();
    this.listeners.add(listener);

    return {
      next: (): Promise<AgentRunEvent | null> => {
        if (closed) return Promise.resolve(null);
        return new Promise<AgentRunEvent | null>((resolve) => {
          waiter = resolve;
          flush();
        });
      },
      close: (): void => {
        closed = true;
        this.listeners.delete(listener);
        const resolve = waiter;
        waiter = null;
        resolve?.(null);
      },
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export class ChatRunCoordinator {
  private readonly sessions: ChatSessionService;
  private readonly agentClient: ChatRunAgentClient;
  private readonly logger: ChatLogger;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly maxRetainedRuns: number;
  private readonly shutdownTimeoutMs: number;
  private readonly channels = new Map<string, RunChannel>();
  private readonly starting = new Map<string, Promise<AgentRunSnapshot>>();
  private readonly consumers = new Set<Promise<void>>();
  private accepting = true;

  constructor(options: ChatRunCoordinatorOptions) {
    this.sessions = options.sessions;
    this.agentClient = options.agentClient;
    this.logger = options.logger ?? {
      info: () => undefined,
      warn: () => undefined,
    };
    this.now = options.now ?? (() => Date.now());
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.maxRetainedRuns = options.maxRetainedRuns ?? DEFAULT_MAX_RETAINED_RUNS;
    this.shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }

  /**
   * 接受一次发送。
   *
   * 顺序固定为「先保存用户消息与 run 记录，再调用 Agent」：这样 Agent 拒绝时
   * 用户输入不会丢失，只会被标记为发送失败；相同 `runId` 重复提交不会重复写入
   * 消息，也不会重复启动 Agent loop。进行中的 startRun 以 runId 去重：并发重发
   * 等待首次开始的结果，避免 TOCTOU 窗口内重复调用 Agent 并重复消费事件流。
   */
  async startRun(params: ChatRunStartParams): Promise<AgentRunSnapshot> {
    if (!this.accepting) throw new ChatServiceClosedError();
    this.prune();

    const inFlight = this.starting.get(params.runId);
    if (inFlight !== undefined) {
      this.logger.info("chat.run.duplicate", { runId: params.runId });
      return inFlight;
    }
    const task = this.beginRun(params).finally(() => {
      this.starting.delete(params.runId);
    });
    this.starting.set(params.runId, task);
    return task;
  }

  /** 单次开始尝试；同一 runId 同时最多存在一个。 */
  private async beginRun(
    params: ChatRunStartParams,
  ): Promise<AgentRunSnapshot> {
    const begun = await this.sessions.beginUserMessage(params);
    if (!begun.created && begun.run.snapshot !== undefined) {
      return begun.run.snapshot;
    }

    const channel = this.ensureChannel(params.runId);
    let snapshot: AgentRunSnapshot;
    try {
      snapshot = await this.agentClient.createRun({
        sessionId: params.sessionId,
        runId: params.runId,
        message: params.message,
      });
    } catch (error) {
      await this.sessions.markRunCreateFailed(params.runId);
      channel.finish(this.now());
      // 移除已终结通道：相同 runId 的重试必须创建新通道，
      // 否则订阅者会立刻收到空流而永远看不到重试后的回答。
      this.channels.delete(params.runId);
      this.logger.warn("chat.run.create-failed", { runId: params.runId });
      throw error;
    }

    await this.sessions.markRunAccepted({
      runId: params.runId,
      snapshot,
    });
    this.logger.info("chat.run.accepted", {
      runId: params.runId,
      sessionId: params.sessionId,
    });
    this.consume(channel);
    return snapshot;
  }

  /** 订阅一个本进程创建的 run；未知或已过期时抛出 `ChatRunNotFoundError`。 */
  subscribe(runId: string): ChatRunSubscription {
    this.prune();
    const channel = this.channels.get(runId);
    if (channel === undefined) throw new ChatRunNotFoundError();
    this.logger.info("chat.sse.subscribed", { runId });
    return channel.subscribe();
  }

  /** 读取通道记录的上游稳定拒绝；SSE 空流时用于返回准确的错误码。 */
  getUpstreamRejection(runId: string): ChatRunUpstreamRejection | undefined {
    return this.channels.get(runId)?.rejectedWith;
  }

  /**
   * 优雅关闭：先停止接受新 run，再有界等待活动消费收敛。
   *
   * 超时仍未收敛的 run 会被标记为失败，避免会话详情永久停留在 `streaming`。
   */
  async close(): Promise<void> {
    this.accepting = false;
    const pending = [...this.consumers];
    if (pending.length > 0) {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>((resolve) => {
          setTimeout(resolve, this.shutdownTimeoutMs).unref?.();
        }),
      ]);
    }
    for (const channel of this.channels.values()) {
      if (channel.finished) continue;
      await this.sessions
        .finishRun({ runId: channel.runId, status: "failed" })
        .catch(() => undefined);
      channel.finish(this.now());
      this.logger.warn("chat.run.interrupted", { runId: channel.runId });
    }
  }

  /** 创建 run 通道并启动唯一的上游消费。 */
  private consume(channel: RunChannel): void {
    const task = this.consumeUpstream(channel).finally(() => {
      this.consumers.delete(task);
    });
    this.consumers.add(task);
  }

  private async consumeUpstream(channel: RunChannel): Promise<void> {
    let assistantStarted = false;
    try {
      for await (const event of this.agentClient.streamEvents(channel.runId)) {
        if (event.type === "answer.delta") {
          if (!assistantStarted) {
            await this.sessions.startAssistantAnswer(channel.runId);
            assistantStarted = true;
          }
          // 先落库再广播，保证订阅者读到与事件一致的会话内容。
          await this.sessions.appendAnswerDelta({
            runId: channel.runId,
            text: event.text,
          });
          channel.publish(event, this.now());
          continue;
        }
        if (isTerminalEvent(event)) {
          await this.sessions.finishRun({
            runId: channel.runId,
            status: toFinishStatus(event),
          });
          channel.publish(event, this.now());
          return;
        }
        channel.publish(event, this.now());
      }
      // 上游在终态前结束：按失败收敛并结束订阅，用户看到的是通用失败提示。
      await this.sessions.finishRun({
        runId: channel.runId,
        status: "failed",
      });
      channel.finish(this.now());
      this.logger.warn("chat.run.stream-ended", { runId: channel.runId });
    } catch (error) {
      // 上游连接、超时或协议错误：不把内部错误详情写入会话或日志正文；
      // Agent 稳定拒绝则记录在通道上，供 SSE 空流时回放给订阅者。
      const rejection = toUpstreamRejection(error);
      await this.sessions
        .finishRun({ runId: channel.runId, status: "failed" })
        .catch(() => undefined);
      channel.finish(this.now(), rejection);
      this.logger.warn("chat.run.stream-failed", { runId: channel.runId });
    }
  }

  private ensureChannel(runId: string): RunChannel {
    const existing = this.channels.get(runId);
    if (existing !== undefined) return existing;
    const channel = new RunChannel(runId, this.now());
    this.channels.set(runId, channel);
    return channel;
  }

  /** 回收超过保留期的终态 run，并限制同时保留的 run 总数。 */
  private prune(): void {
    const now = this.now();
    for (const [runId, channel] of this.channels) {
      const finishedAt = channel.finishedAt;
      if (finishedAt !== undefined && now - finishedAt > this.retentionMs) {
        this.channels.delete(runId);
      }
    }
    if (this.channels.size <= this.maxRetainedRuns) return;
    const oldest = [...this.channels.values()].sort(
      (a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt),
    );
    for (const channel of oldest) {
      if (this.channels.size <= this.maxRetainedRuns) break;
      if (!channel.finished) continue;
      this.channels.delete(channel.runId);
    }
  }
}
