import type { AgentNotReadyReason } from "@renewal/contracts/agent";
import type { AgentConfig } from "../config/agent_config.js";
import { loadAgentConfig } from "../config/agent_config.js";
import { createAgentHttpServer } from "../interfaces/http/server.js";
import { loadAgentModelRuntime } from "../runtime/agent_model_runtime.js";
import {
  loadAgentResources,
  readConfiguredContextFiles,
} from "../runtime/agent_resources.js";
import { createAgentRunSession } from "../runtime/agent_session.js";
import { createRunEventProjector } from "../runtime/run_event_projector.js";
import {
  AgentRunRegistry,
  type AgentRunLogger,
} from "../runtime/run_registry.js";

/**
 * 结构化运行日志：JSON 行输出，与启动日志同构。
 *
 * info 走 stdout（启动摘要必须是 stdout 第一行），warn/error 走 stderr，
 * 便于部署侧分流采集。字段必须脱敏：只记录 runId/sessionId/状态与错误摘要，
 * 不记录 prompt、回答正文、文件内容或凭据。
 */
function createStdoutRunLogger(): AgentRunLogger {
  /** 输出一行 JSON 日志：info 走 stdout，warn/error 走 stderr。 */
  const write = (
    level: "info" | "warn" | "error",
    event: string,
    detail?: Record<string, unknown>,
  ): void => {
    const stream = level === "info" ? process.stdout : process.stderr;
    stream.write(`${JSON.stringify({ level, event, ...detail })}\n`);
  };
  return {
    info: (event, detail) => write("info", event, detail),
    warn: (event, detail) => write("warn", event, detail),
    error: (event, detail) => write("error", event, detail),
  };
}

export interface InsuranceAgentService {
  readonly config: AgentConfig;
  readonly registry: AgentRunRegistry;
  readonly ready: boolean;
  readonly reasons: readonly AgentNotReadyReason[];
  readonly warnings: readonly string[];
  listen(): Promise<string>;
  close(): Promise<void>;
}

/**
 * 装配服务：并行初始化模型运行时与受控资源，据此确定 readiness，再组装
 * registry 与 HTTP 服务。not-ready 时仍会监听，但创建 run 一律被拒绝。
 */
export async function createInsuranceAgentService(
  config = loadAgentConfig(),
): Promise<InsuranceAgentService> {
  const [modelResult, resourceResult] = await Promise.all([
    loadAgentModelRuntime(config),
    loadAgentResources(config),
  ]);
  const reasons = [
    ...(modelResult.status === "ready" ? [] : modelResult.reasons),
    ...(resourceResult.status === "ready" ? [] : resourceResult.reasons),
  ];
  const warnings = [...modelResult.warnings, ...resourceResult.warnings];
  const ready = reasons.length === 0;

  const runLogger = createStdoutRunLogger();
  // readiness 失败时逐条落日志：启动摘要只带枚举码，具体原因需要可回查。
  if (!ready) {
    runLogger.warn("service.not-ready", { reasons: [...reasons] });
    for (const warning of warnings) {
      runLogger.warn("service.readiness-warning", { warning });
    }
  }
  const registry = new AgentRunRegistry({
    config,
    // 每 run 创建独立投影器：turnIndex 与工具计时不能跨 run 串扰。
    createProjector: () => createRunEventProjector(),
    logger: runLogger,
    createSession: async ({ runId }) => {
      // 启动后上下文文件可能被删除：run 仍可执行，但必须留下告警线索。
      const { missingPaths } = readConfiguredContextFiles(config);
      if (missingPaths.length > 0) {
        runLogger.warn("run.context-files-missing", { runId, missingPaths });
      }
      if (modelResult.status !== "ready") {
        throw new Error("Agent model runtime is not ready");
      }
      return createAgentRunSession({
        config,
        modelRuntime: modelResult.modelRuntime,
        model: modelResult.model,
      });
    },
  });
  const server = createAgentHttpServer({
    config,
    registry,
    state: { ready, reasons, warnings },
    logger: runLogger,
  });
  let closed = false;

  return {
    config,
    registry,
    ready,
    reasons,
    warnings,
    listen: () => server.listen(config.http),
    close: async () => {
      if (closed) return;
      closed = true;
      await registry.stopAll();
      await server.close();
    },
  };
}
