import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../../src/config/agent_config.js";
import {
  AgentRunRegistry,
  type AgentRunClock,
  type AgentRunEventDraft,
  type AgentRunLogger,
  type AgentRunSessionHandle,
} from "../../src/runtime/run_registry.js";

/**
 * 测试夹具：构造不依赖文件系统与真实 SDK 的 registry/会话替身。
 *
 * 真实 SDK 装配由 runtime 层的集成测试覆盖；这里用于确定性地验证并发、超时、
 * 终态收敛与 HTTP 契约。
 */

export function buildConfig(
  runtime: Partial<AgentConfig["runtime"]> = {},
): AgentConfig {
  return {
    repositoryRoot: "/repo",
    configPath: "/repo/config/insurance-agent.json",
    agentName: "insurance-agent",
    workingDirectory: "/repo/work",
    model: {
      provider: "opencode-go",
      id: "deepseek-flash",
      thinkingLevel: "high",
      apiKeyEnv: "INSURANCE_AGENT_API_KEY",
      catalogRefreshTimeoutMs: 15_000,
    },
    runtime: {
      dataDirectory: "/repo/.runtime/insurance-agent",
      maxConcurrentRuns: 4,
      runTimeoutMs: 300_000,
      eventRetentionMs: 900_000,
      maxEventsPerRun: 1_000,
      ...runtime,
    },
    tools: ["read", "grep", "find", "ls"],
    resources: { skillPaths: [], contextPaths: [] },
    http: { host: "127.0.0.1", port: 0 },
  };
}

export interface TestClock {
  readonly clock: AgentRunClock;
  /** 触发所有已注册的定时器（本次触发期间新注册的不受影响）。 */
  readonly fireTimeouts: () => void;
}

/** 受控时钟：手动触发定时器，避免用例依赖真实时间。 */
export function createTestClock(): TestClock {
  const timers = new Map<number, { callback: () => void }>();
  let nextId = 1;

  return {
    clock: {
      now: () => 1_700_000_000_000,
      setTimer: (callback) => {
        const id = nextId;
        nextId += 1;
        timers.set(id, { callback });
        return () => {
          timers.delete(id);
        };
      },
    },
    fireTimeouts: () => {
      const pending = [...timers.values()];
      timers.clear();
      for (const timer of pending) timer.callback();
    },
  };
}

export interface StubSession extends AgentRunSessionHandle {
  aborted: boolean;
  disposed: boolean;
  emit(event: AgentSessionEvent): void;
}

let sessionCounter = 0;

/** 创建可手动 emit 事件的 session 替身。 */
export function createStubSession(
  promptImpl: (message: string) => Promise<void>,
): StubSession {
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  sessionCounter += 1;

  return {
    piSessionId: `pi-session-${sessionCounter}`,
    aborted: false,
    disposed: false,
    /** 向所有订阅者广播事件。 */
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    /** 订阅事件并返回取消函数。 */
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prompt: promptImpl,
    async abort() {
      this.aborted = true;
    },
    async dispose() {
      this.disposed = true;
    },
  };
}

export interface CapturedLogEntry {
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly detail?: Record<string, unknown>;
}

export interface RecordingLogger extends AgentRunLogger {
  readonly entries: CapturedLogEntry[];
}

/** 测试用日志替身：记录全部条目，供断言关键步骤是否留痕。 */
export function createRecordingLogger(): RecordingLogger {
  const entries: CapturedLogEntry[] = [];
  /** 生成记录指定级别的日志函数。 */
  const record = (level: CapturedLogEntry["level"]): AgentRunLogger["info"] => {
    return (event, detail) => {
      entries.push({
        level,
        event,
        ...(detail === undefined ? {} : { detail }),
      });
    };
  };
  return {
    entries,
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

/** 永不结束的 prompt，用于保持 run 处于活动状态。 */
export function hanging(): Promise<void> {
  return new Promise<void>(() => {});
}

export interface RegistryHarness {
  readonly registry: AgentRunRegistry;
  readonly clock: TestClock;
  readonly sessions: StubSession[];
}

/** 组装 registry 与可控 session/时钟的测试夹具。 */
export function createRegistryHarness(
  options: {
    runtime?: Partial<AgentConfig["runtime"]>;
    promptImpl?: (message: string) => Promise<void>;
    createProjector?: () => (
      event: AgentSessionEvent,
    ) => AgentRunEventDraft | undefined;
    logger?: AgentRunLogger;
  } = {},
): RegistryHarness {
  const clock = createTestClock();
  const sessions: StubSession[] = [];
  const registry = new AgentRunRegistry({
    config: buildConfig(options.runtime),
    clock: clock.clock,
    createSession: async () => {
      const session = createStubSession(options.promptImpl ?? (async () => {}));
      sessions.push(session);
      return session;
    },
    ...(options.createProjector === undefined
      ? {}
      : { createProjector: options.createProjector }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  return { registry, clock, sessions };
}
