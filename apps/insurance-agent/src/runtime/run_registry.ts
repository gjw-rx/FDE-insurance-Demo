import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type {
  AgentRunAbortReason,
  AgentRunEvent,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentServiceErrorCode,
} from "@renewal/contracts/agent";
import type { AgentConfig } from "../config/agent_config.js";

/**
 * run 生命周期注册表。
 *
 * 负责：runId 幂等、并发上限、每 run deadline、单一终态收敛（compare-and-set）、
 * 以及每个 run 的事件序号与内存 replay 缓冲。事件载荷由注入的 `projectEvent`
 * 投影（脱敏），这里只补齐 agentName/sessionId/runId/cursor/at。
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** 对外事件去掉 registry 补齐的字段后的载荷；投影函数只需产出业务字段。 */
export type AgentRunEventDraft = DistributiveOmit<
  AgentRunEvent,
  "agentName" | "sessionId" | "runId" | "cursor" | "at"
>;

/**
 * registry 需要的最小会话能力。
 *
 * `AgentRunSession`（SDK runtime 句柄）结构上满足该接口；测试可用轻量替身实现，
 * 因此 registry 不直接依赖 SDK 类型。
 */
export interface AgentRunSessionHandle {
  readonly piSessionId: string;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AgentRunClock {
  now(): number;
  /** 返回取消函数。 */
  setTimer(callback: () => void, delayMs: number): () => void;
}

/** registry 运行日志的最小接口；事件与字段必须脱敏，不得包含 prompt、回答正文或文件内容。 */
export interface AgentRunLogger {
  info(event: string, detail?: Record<string, unknown>): void;
  warn(event: string, detail?: Record<string, unknown>): void;
  error(event: string, detail?: Record<string, unknown>): void;
}

const noopLogger: AgentRunLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** 错误摘要只保留名称与消息，用于运行日志；不枚举堆栈或任意属性。 */
function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

export interface AgentRunRegistryOptions {
  readonly config: AgentConfig;
  readonly createSession: (input: {
    readonly runId: string;
    readonly sessionId: string;
  }) => Promise<AgentRunSessionHandle>;
  /**
   * 为每个 run 创建独立的事件投影器；返回 undefined 表示不对外暴露。
   *
   * 投影器内部持有 turn 计数与工具计时等 run 内状态，必须是每 run 一个实例，
   * 跨 run 共享会导致 turnIndex 与 durationMs 串扰。
   */
  readonly createProjector?: () => (
    event: AgentSessionEvent,
  ) => AgentRunEventDraft | undefined;
  readonly clock?: AgentRunClock;
  readonly logger?: AgentRunLogger;
}

export interface AgentRunCreateInput {
  readonly sessionId: string;
  readonly runId: string;
  readonly message: string;
}

export type AgentRunCreateOutcome =
  | { readonly kind: "accepted"; readonly snapshot: AgentRunSnapshot }
  | { readonly kind: "existing"; readonly snapshot: AgentRunSnapshot }
  | {
      readonly kind: "rejected";
      readonly code: AgentServiceErrorCode;
      readonly retryable: boolean;
    };

export type AgentRunAbortOutcome =
  | {
      readonly kind: "aborted" | "already-finished";
      readonly snapshot: AgentRunSnapshot;
    }
  | { readonly kind: "not-found" };

interface RunRecord {
  readonly runId: string;
  readonly sessionId: string;
  readonly createdAt: number;
  status: AgentRunStatus;
  finishedAt?: number;
  abortReason?: AgentRunAbortReason;
  errorCode?: AgentServiceErrorCode;
  session?: AgentRunSessionHandle | undefined;
  unsubscribe?: (() => void) | undefined;
  cancelTimeout?: (() => void) | undefined;
  cancelRetention?: (() => void) | undefined;
  cursor: number;
  /** 事件缓冲是否已因超过上限被裁剪；用于只告警一次。 */
  bufferTruncated?: boolean;
  readonly events: AgentRunEvent[];
  readonly subscribers: Set<(event: AgentRunEvent) => void>;
}

const TERMINAL_STATUSES: readonly AgentRunStatus[] = [
  "completed",
  "failed",
  "aborted",
];

/** 是否为终态状态。 */
function isTerminal(status: AgentRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

const defaultClock: AgentRunClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

export class AgentRunRegistry {
  private readonly runs = new Map<string, RunRecord>();
  private readonly options: AgentRunRegistryOptions;
  private readonly clock: AgentRunClock;
  private readonly logger: AgentRunLogger;
  private activeCount = 0;
  private closed = false;

  /** 未注入时钟/日志时使用进程时钟与静默日志。 */
  constructor(options: AgentRunRegistryOptions) {
    this.options = options;
    this.clock = options.clock ?? defaultClock;
    this.logger = options.logger ?? noopLogger;
  }

  /** 活动（未进入终态）run 数量。 */
  get activeRuns(): number {
    return this.activeCount;
  }

  /** 读取 run 快照；run 不存在或已过保留期时返回 undefined。 */
  getSnapshot(runId: string): AgentRunSnapshot | undefined {
    const record = this.runs.get(runId);
    return record === undefined ? undefined : this.snapshot(record);
  }

  /** 读取 run 状态，供内部判定与测试使用。 */
  getStatus(runId: string): AgentRunStatus | undefined {
    return this.runs.get(runId)?.status;
  }

  /**
   * 接受一个 run。
   *
   * 同一 runId 重复提交返回既有快照且不启动第二个 Agent loop；达到并发上限时
   * 返回可重试的容量错误，不影响正在运行的 run。
   */
  async create(input: AgentRunCreateInput): Promise<AgentRunCreateOutcome> {
    const existing = this.runs.get(input.runId);
    if (existing !== undefined) {
      this.logger.info("run.duplicate", {
        sessionId: input.sessionId,
        runId: input.runId,
      });
      return { kind: "existing", snapshot: this.snapshot(existing) };
    }

    if (this.closed) {
      this.logger.warn("run.rejected.service-closed", {
        runId: input.runId,
      });
      return { kind: "rejected", code: "SERVICE_NOT_READY", retryable: true };
    }

    if (this.activeCount >= this.options.config.runtime.maxConcurrentRuns) {
      this.logger.warn("run.rejected.capacity-exceeded", {
        runId: input.runId,
        activeRuns: this.activeCount,
        maxConcurrentRuns: this.options.config.runtime.maxConcurrentRuns,
      });
      return { kind: "rejected", code: "CAPACITY_EXCEEDED", retryable: true };
    }

    const record: RunRecord = {
      runId: input.runId,
      sessionId: input.sessionId,
      createdAt: this.clock.now(),
      status: "accepted",
      cursor: 0,
      events: [],
      subscribers: new Set(),
    };
    this.runs.set(record.runId, record);
    this.activeCount += 1;
    this.logger.info("run.accepted", {
      sessionId: input.sessionId,
      runId: input.runId,
    });

    this.appendEvent(record, { type: "run.accepted" } as AgentRunEventDraft);

    record.cancelTimeout = this.clock.setTimer(() => {
      void this.abort(input.runId, "timeout");
    }, this.options.config.runtime.runTimeoutMs);

    void this.execute(record, input.message);

    return { kind: "accepted", snapshot: this.snapshot(record) };
  }

  /** 幂等停止：终态 run 返回既有快照，不产生第二个终态。 */
  async abort(
    runId: string,
    reason: AgentRunAbortReason = "requested",
  ): Promise<AgentRunAbortOutcome> {
    const record = this.runs.get(runId);
    if (record === undefined) return { kind: "not-found" };
    if (isTerminal(record.status)) {
      return { kind: "already-finished", snapshot: this.snapshot(record) };
    }

    this.logger.info("run.abort-requested", { runId, reason });
    await this.finalize(record, "aborted", { abortReason: reason });

    return { kind: "aborted", snapshot: this.snapshot(record) };
  }

  /** 返回 cursor 大于 afterCursor 的已缓冲事件，以及在保留期内的最早 cursor。 */
  eventsSince(
    runId: string,
    afterCursor: number,
  ):
    | {
        readonly events: readonly AgentRunEvent[];
        readonly earliestCursor: number;
      }
    | undefined {
    const record = this.runs.get(runId);
    if (record === undefined) return undefined;

    const earliestCursor = record.events[0]?.cursor ?? record.cursor + 1;
    return {
      events: record.events.filter((event) => event.cursor > afterCursor),
      earliestCursor,
    };
  }

  /** 订阅 run 的后续事件；run 已进入终态时立即收到终态事件。 */
  subscribe(
    runId: string,
    listener: (event: AgentRunEvent) => void,
  ): (() => void) | undefined {
    const record = this.runs.get(runId);
    if (record === undefined) return undefined;

    record.subscribers.add(listener);
    return () => {
      record.subscribers.delete(listener);
    };
  }

  /** run 是否已终态；不存在的 runId 视为终态，避免调用方继续等待。 */
  isTerminal(runId: string): boolean {
    const record = this.runs.get(runId);
    return record === undefined ? true : isTerminal(record.status);
  }

  /** 停止接收新 run 并中断所有活动 run（进程关闭时使用）。 */
  async stopAll(reason: AgentRunAbortReason = "requested"): Promise<void> {
    this.closed = true;
    const runIds = [...this.runs.values()]
      .filter((record) => !isTerminal(record.status))
      .map((record) => record.runId);
    this.logger.info("service.stopping", { activeRuns: runIds.length });

    await Promise.all(runIds.map((runId) => this.abort(runId, reason)));
  }

  /**
   * 执行单个 run：创建 session、订阅并投影事件、调用 prompt，最后收敛终态。
   *
   * session 创建或 prompt 抛错时只记录脱敏错误摘要，对外始终收敛为 INTERNAL_ERROR。
   */
  private async execute(record: RunRecord, message: string): Promise<void> {
    let session: AgentRunSessionHandle;
    try {
      session = await this.options.createSession({
        runId: record.runId,
        sessionId: record.sessionId,
      });
    } catch (error) {
      // 原始异常只进运行日志（脱敏摘要），对外事件仍只暴露稳定错误码。
      this.logger.error("run.session-create-failed", {
        runId: record.runId,
        error: describeError(error),
      });
      await this.finalize(record, "failed", { errorCode: "INTERNAL_ERROR" });
      return;
    }

    if (isTerminal(record.status)) {
      await session.dispose();
      return;
    }

    record.session = session;
    record.status = "running";
    // 每 run 独立投影器：turnIndex 与工具计时不能跨 run 串扰。
    const projectEvent = this.options.createProjector?.();
    record.unsubscribe = session.subscribe((event) => {
      if (projectEvent === undefined) return;
      const draft = projectEvent(event);
      if (draft !== undefined) this.appendEvent(record, draft);
    });
    this.appendEvent(record, { type: "agent.started" } as AgentRunEventDraft);

    try {
      await session.prompt(message);
      await this.finalize(record, "completed");
    } catch (error) {
      this.logger.error("run.prompt-failed", {
        runId: record.runId,
        error: describeError(error),
      });
      await this.finalize(record, "failed", { errorCode: "INTERNAL_ERROR" });
    }
  }

  /** 单一终态收敛：只有第一次调用生效。 */
  private finalize(
    record: RunRecord,
    status: Extract<AgentRunStatus, "completed" | "failed" | "aborted">,
    detail: {
      readonly abortReason?: AgentRunAbortReason;
      readonly errorCode?: AgentServiceErrorCode;
    } = {},
  ): Promise<void> {
    if (isTerminal(record.status)) return Promise.resolve();

    record.status = status;
    record.finishedAt = this.clock.now();
    if (detail.abortReason !== undefined)
      record.abortReason = detail.abortReason;
    if (detail.errorCode !== undefined) record.errorCode = detail.errorCode;
    this.activeCount -= 1;

    this.logger.info(`run.${status}`, {
      runId: record.runId,
      ...(status === "aborted"
        ? { abortReason: record.abortReason ?? "requested" }
        : {}),
      ...(status === "failed"
        ? { errorCode: record.errorCode ?? "INTERNAL_ERROR" }
        : {}),
    });

    record.cancelTimeout?.();
    record.cancelTimeout = undefined;
    record.unsubscribe?.();
    record.unsubscribe = undefined;

    if (status === "completed") {
      this.appendEvent(record, { type: "run.completed" } as AgentRunEventDraft);
    } else if (status === "failed") {
      this.appendEvent(record, {
        type: "run.failed",
        errorCode: record.errorCode ?? "INTERNAL_ERROR",
      } as AgentRunEventDraft);
    } else {
      this.appendEvent(record, {
        type: "run.aborted",
        reason: record.abortReason ?? "requested",
      } as AgentRunEventDraft);
    }

    const session = record.session;
    record.session = undefined;

    // 终态后按配置保留一段时间的快照与事件缓冲，到期释放内存。
    record.cancelRetention = this.clock.setTimer(() => {
      record.subscribers.clear();
      this.runs.delete(record.runId);
    }, this.options.config.runtime.eventRetentionMs);

    if (session === undefined) return Promise.resolve();
    return (async () => {
      if (status === "aborted") {
        try {
          await session.abort();
        } catch {
          // session 可能已在 provider 侧结束，仍继续释放 runtime。
        }
      }
      await session.dispose();
    })();
  }

  /** 补齐标识与 cursor 后写入缓冲，按上限裁剪，再广播给订阅者。 */
  private appendEvent(record: RunRecord, draft: AgentRunEventDraft): void {
    const event = {
      ...draft,
      agentName: this.options.config.agentName,
      sessionId: record.sessionId,
      runId: record.runId,
      cursor: record.cursor + 1,
      at: new Date(this.clock.now()).toISOString(),
    } as AgentRunEvent;

    record.cursor = event.cursor;
    record.events.push(event);

    const maxEvents = this.options.config.runtime.maxEventsPerRun;
    if (record.events.length > maxEvents && record.bufferTruncated !== true) {
      record.bufferTruncated = true;
      // 只告警一次：裁剪意味着断线续接可能收到 EVENT_CURSOR_EXPIRED。
      this.logger.warn("run.event-buffer-truncated", {
        runId: record.runId,
        maxEvents,
      });
    }
    while (record.events.length > maxEvents) {
      record.events.shift();
    }

    for (const subscriber of record.subscribers) {
      try {
        subscriber(event);
      } catch {
        // 单个断开的传输消费者不能影响 run 收敛或其他订阅者。
        record.subscribers.delete(subscriber);
      }
    }
  }

  /** 由内部记录生成对外快照；可选字段只在存在时输出。 */
  private snapshot(record: RunRecord): AgentRunSnapshot {
    return {
      agentName: this.options.config.agentName,
      sessionId: record.sessionId,
      runId: record.runId,
      status: record.status,
      createdAt: new Date(record.createdAt).toISOString(),
      ...(record.finishedAt === undefined
        ? {}
        : { finishedAt: new Date(record.finishedAt).toISOString() }),
      ...(record.abortReason === undefined
        ? {}
        : { abortReason: record.abortReason }),
      ...(record.errorCode === undefined
        ? {}
        : { errorCode: record.errorCode }),
    };
  }
}
