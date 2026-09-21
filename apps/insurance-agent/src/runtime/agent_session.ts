import {
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type AgentSession,
  type AgentSessionEventListener,
  type AgentSessionRuntime,
  type AgentSessionRuntimeDiagnostic,
  type CreateAgentSessionRuntimeFactory,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../config/agent_config.js";
import {
  agentResourceLoaderOptions,
  type AgentResourceLoaderDeps,
} from "./agent_resources.js";
import { builtinExtensionFactories } from "./builtin_extensions.js";
import type { AgentResolvedModel } from "./agent_model_runtime.js";

/**
 * 每个 run 一个 SDK runtime。
 *
 * 利用 `AgentSessionRuntime` 装配 cwd 绑定的 services 和 AgentSession：受控工作目录、
 * 内存 session（不落盘、不与开发会话共享）、显式模型与 thinking level、以及只读工具
 * 白名单。run 结束后必须调用 `dispose()` 释放订阅与 session 资源。
 */

export interface AgentRunSessionOptions extends AgentResourceLoaderDeps {
  readonly config: AgentConfig;
  readonly modelRuntime: ModelRuntime;
  readonly model: AgentResolvedModel;
}

export interface AgentRunSession {
  readonly session: AgentSession;
  readonly runtime: AgentSessionRuntime;
  /** Pi 内部 session ID，仅用于诊断关联；对外标识仍使用项目 runId/sessionId。 */
  readonly piSessionId: string;
  readonly diagnostics: readonly AgentSessionRuntimeDiagnostic[];
  subscribe(listener: AgentSessionEventListener): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * 创建一个 run 的 SDK 运行时与 session。
 *
 * 安全边界（受控 cwd、内存 session、显式模型与只读工具）由服务统一注入，
 * 调用方只能追加 extension；返回句柄必须由调用方 dispose。
 */
export async function createAgentRunSession(
  options: AgentRunSessionOptions,
): Promise<AgentRunSession> {
  const { config, modelRuntime, model } = options;
  const settingsManager = SettingsManager.inMemory();
  // 安全边界由服务统一注入：调用方的 extensionFactories 只能是额外补充。
  const extensionFactories = [
    ...builtinExtensionFactories(config),
    ...(options.extensionFactories ?? []),
  ];
  const resourceLoaderOptions = agentResourceLoaderOptions(config, {
    extensionFactories,
  });
  const tools = [...config.tools];

  // factory 会在 cwd 变化时重建 services；服务端只使用固定的受控工作目录。
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
  }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      settingsManager,
      modelRuntime,
      resourceLoaderOptions,
    });
    const created = await createAgentSessionFromServices({
      services,
      sessionManager,
      model,
      thinkingLevel: config.model.thinkingLevel,
      tools,
    });

    return { ...created, services, diagnostics: [...services.diagnostics] };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: config.workingDirectory,
    agentDir: config.runtime.dataDirectory,
    sessionManager: SessionManager.inMemory(config.workingDirectory),
  });

  const session = runtime.session;
  let disposed = false;

  return {
    session,
    runtime,
    piSessionId: session.sessionId,
    diagnostics: runtime.diagnostics,
    subscribe: (listener) => session.subscribe(listener),
    prompt: (text) => session.prompt(text),
    abort: () => session.abort(),
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      try {
        await session.abort();
      } catch {
        // run 已结束时无需再次中断。
      }
      await runtime.dispose();
    },
  };
}
