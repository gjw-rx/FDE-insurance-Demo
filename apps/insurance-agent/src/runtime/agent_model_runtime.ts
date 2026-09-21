import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentNotReadyReason } from "@renewal/contracts/agent";
import type { AgentConfig } from "../config/agent_config.js";

/**
 * 应用专属模型运行时。
 *
 * 所有 SDK 路径都显式指向 insurance-agent 自己的 runtime data 目录，绝不读取
 * `.pi/settings.json`、`~/.pi/agent/settings.json`、`models.json` 或 `auth.json`。
 * 模型解析严格使用配置的 provider/model，不做任何回退。
 */

/** 从 SDK 推导的已解析模型类型，避免生产代码直接依赖 pi-ai 类型包。 */
export type AgentResolvedModel = NonNullable<
  ReturnType<ModelRuntime["getModel"]>
>;

export interface AgentModelRuntimePaths {
  readonly authPath: string;
  readonly modelsPath: string;
  readonly modelsStorePath: string;
}

export interface AgentModelRuntimeReady {
  readonly status: "ready";
  readonly modelRuntime: ModelRuntime;
  readonly model: AgentResolvedModel;
  readonly warnings: readonly string[];
}

export interface AgentModelRuntimeNotReady {
  readonly status: "not-ready";
  readonly reasons: readonly AgentNotReadyReason[];
  readonly warnings: readonly string[];
}

export type AgentModelRuntimeResult =
  | AgentModelRuntimeReady
  | AgentModelRuntimeNotReady;

/** 可替换依赖：测试用 faux provider 和受控刷新替换真实网络与凭据。 */
export interface AgentModelRuntimeDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly createModelRuntime?: (
    paths: AgentModelRuntimePaths,
  ) => Promise<ModelRuntime>;
  readonly registerProviders?: (modelRuntime: ModelRuntime) => void;
  readonly refreshCatalog?: (
    modelRuntime: ModelRuntime,
    timeoutMs: number,
  ) => Promise<void>;
}

/** runtime data 目录下的三个 SDK 文件；凭据文件只读不写。 */
export function agentModelRuntimePaths(
  config: AgentConfig,
): AgentModelRuntimePaths {
  return {
    authPath: join(config.runtime.dataDirectory, "auth.json"),
    modelsPath: join(config.runtime.dataDirectory, "models.json"),
    modelsStorePath: join(config.runtime.dataDirectory, "models-store.json"),
  };
}

/** 只恢复独立缓存，不在创建阶段联网刷新。 */
async function createIsolatedModelRuntime(
  paths: AgentModelRuntimePaths,
): Promise<ModelRuntime> {
  return ModelRuntime.create({
    authPath: paths.authPath,
    modelsPath: paths.modelsPath,
    modelsStorePath: paths.modelsStorePath,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
}

/** 有界刷新：超时后 abort 并失败，避免启动被挂起的 provider 拖住。 */
export async function refreshCatalogWithTimeout(
  modelRuntime: ModelRuntime,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("模型目录刷新超时"));
    }, timeoutMs);
  });

  try {
    await Promise.race([
      modelRuntime.refresh({ signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 初始化模型运行时并验证配置模型可用。
 *
 * 刷新失败或超时、模型不可解析、凭据不可用都返回 not-ready：catalog 未确认时
 * 服务不接流量，也不会改用其他模型。
 */
export async function loadAgentModelRuntime(
  config: AgentConfig,
  deps: AgentModelRuntimeDeps = {},
): Promise<AgentModelRuntimeResult> {
  const env = deps.env ?? process.env;
  const warnings: string[] = [];
  /** 构造 not-ready 结果，沿用已收集的 warnings。 */
  const notReady = (
    reason: AgentNotReadyReason,
  ): AgentModelRuntimeNotReady => ({
    status: "not-ready",
    reasons: [reason],
    warnings,
  });

  const paths = agentModelRuntimePaths(config);

  let modelRuntime: ModelRuntime;
  try {
    modelRuntime = await (
      deps.createModelRuntime ?? createIsolatedModelRuntime
    )(paths);
  } catch {
    warnings.push("模型运行时初始化失败");
    return notReady("MODEL_UNAVAILABLE");
  }

  try {
    deps.registerProviders?.(modelRuntime);
  } catch {
    warnings.push("模型 provider 注册失败");
    return notReady("MODEL_UNAVAILABLE");
  }

  const apiKey = env[config.model.apiKeyEnv];
  if (typeof apiKey === "string" && apiKey.trim().length > 0) {
    try {
      await modelRuntime.setRuntimeApiKey(config.model.provider, apiKey.trim());
    } catch {
      warnings.push("模型凭据注入失败");
      return notReady("MODEL_UNAVAILABLE");
    }
  }

  if (config.model.catalogRefreshTimeoutMs > 0) {
    const refresh = deps.refreshCatalog ?? refreshCatalogWithTimeout;
    try {
      await refresh(modelRuntime, config.model.catalogRefreshTimeoutMs);
    } catch {
      warnings.push("模型目录刷新失败或超时");
      return notReady("MODEL_UNAVAILABLE");
    }
  }

  const { provider, id } = config.model;
  const model = modelRuntime.getModel(provider, id);
  if (model === undefined) {
    warnings.push(`模型目录中不存在配置的模型：${provider}/${id}`);
    return notReady("MODEL_UNAVAILABLE");
  }

  try {
    const auth = await modelRuntime.getAuth(model);
    if (auth === undefined) {
      warnings.push(`provider 未配置可用凭据：${provider}`);
      return notReady("MODEL_UNAVAILABLE");
    }
  } catch {
    warnings.push(`provider 凭据检查失败：${provider}`);
    return notReady("MODEL_UNAVAILABLE");
  }

  return { status: "ready", modelRuntime, model, warnings };
}
