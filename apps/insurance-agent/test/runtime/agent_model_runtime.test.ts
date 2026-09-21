import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createProvider, fauxProvider } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadAgentConfig,
  type AgentConfig,
} from "../../src/config/agent_config.js";
import {
  createTempWorkspace,
  defaultTestConfig,
  type TempWorkspace,
} from "../support/workspace.js";
import {
  agentModelRuntimePaths,
  loadAgentModelRuntime,
  refreshCatalogWithTimeout,
  type AgentModelRuntimeResult,
} from "../../src/runtime/agent_model_runtime.js";

const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => workspace.cleanup()),
  );
});

/** 创建临时 workspace 并加载应用配置。 */
async function setup(config: unknown = defaultTestConfig()): Promise<{
  workspace: TempWorkspace;
  agentConfig: AgentConfig;
}> {
  const workspace = await createTempWorkspace(config);
  workspaces.push(workspace);
  return {
    workspace,
    agentConfig: loadAgentConfig({ configPath: workspace.configPath, env: {} }),
  };
}

/** 注册 faux streaming provider，证明不依赖网络与真实凭据即可跑通 SDK。 */
function registerFauxProvider(
  modelId: string,
): (modelRuntime: ModelRuntime) => void {
  const faux = fauxProvider({
    provider: "opencode-go",
    models: [{ id: modelId }],
  });
  return (modelRuntime) => {
    modelRuntime.registerNativeProvider(faux.provider);
  };
}

/** 注册一个凭据未配置的 provider，用于验证凭据缺失与运行时密钥注入。 */
function registerUnconfiguredProvider(
  modelId: string,
): (modelRuntime: ModelRuntime) => void {
  const faux = fauxProvider({
    provider: "opencode-go",
    models: [{ id: modelId }],
  });
  const provider = createProvider({
    id: "opencode-go",
    auth: {
      apiKey: {
        name: "Unconfigured",
        resolve: async ({ credential }) =>
          credential?.key ? { auth: {} } : undefined,
      },
    },
    models: faux.models,
    api: {
      stream: (model, context, options) =>
        faux.provider.stream(model, context, options),
      streamSimple: (model, context, options) =>
        faux.provider.streamSimple(model, context, options),
    },
  });
  return (modelRuntime) => {
    modelRuntime.registerNativeProvider(provider);
  };
}

/** 断言模型运行时 ready 并收窄类型。 */
function readyResult(
  result: AgentModelRuntimeResult,
): Extract<AgentModelRuntimeResult, { status: "ready" }> {
  if (result.status !== "ready") throw new Error("预期模型运行时 ready");
  return result;
}

/** 断言模型运行时 not-ready 并收窄类型。 */
function notReadyResult(
  result: AgentModelRuntimeResult,
): Extract<AgentModelRuntimeResult, { status: "not-ready" }> {
  if (result.status !== "not-ready")
    throw new Error("预期模型运行时 not-ready");
  return result;
}

describe("runtime data 路径", () => {
  it("三个 SDK 文件都位于应用专属数据目录", async () => {
    const { agentConfig } = await setup();
    const paths = agentModelRuntimePaths(agentConfig);

    expect(paths.authPath).toBe(
      join(agentConfig.runtime.dataDirectory, "auth.json"),
    );
    expect(paths.modelsPath).toBe(
      join(agentConfig.runtime.dataDirectory, "models.json"),
    );
    expect(paths.modelsStorePath).toBe(
      join(agentConfig.runtime.dataDirectory, "models-store.json"),
    );
  });
});

describe("模型可用性", () => {
  it("模型与凭据可用时 ready", async () => {
    const { agentConfig } = await setup();

    const result = readyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: { INSURANCE_AGENT_API_KEY: "sk-test-key" },
        registerProviders: registerFauxProvider("deepseek-flash"),
        refreshCatalog: async () => {},
      }),
    );

    expect(result.model.provider).toBe("opencode-go");
    expect(result.model.id).toBe("deepseek-flash");
    expect(result.warnings).toEqual([]);
  });

  it("目录刷新超时或失败时 not-ready", async () => {
    const { agentConfig } = await setup();

    const failed = notReadyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: { INSURANCE_AGENT_API_KEY: "sk-test-key" },
        registerProviders: registerFauxProvider("deepseek-flash"),
        refreshCatalog: async () => {
          throw new Error("catalog 请求失败");
        },
      }),
    );

    expect(failed.reasons).toContain("MODEL_UNAVAILABLE");
    expect(failed.warnings.join(" ")).toContain("刷新失败或超时");
  });

  it("刷新使用配置的超时上限", async () => {
    const base = defaultTestConfig();
    const { agentConfig } = await setup({
      ...base,
      model: { ...base.model, catalogRefreshTimeoutMs: 4_321 },
    });
    const observed: number[] = [];

    await loadAgentModelRuntime(agentConfig, {
      env: {},
      registerProviders: registerFauxProvider("deepseek-flash"),
      refreshCatalog: async (_modelRuntime, timeoutMs) => {
        observed.push(timeoutMs);
      },
    });

    expect(observed).toEqual([4_321]);
  });

  it("配置模型不在目录中时 not-ready 且不选择其他模型", async () => {
    const { agentConfig } = await setup();

    const result = notReadyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: {},
        registerProviders: registerFauxProvider("some-other-model"),
        refreshCatalog: async () => {},
      }),
    );

    expect(result.reasons).toContain("MODEL_UNAVAILABLE");
    expect(result.warnings.join(" ")).toContain("deepseek-flash");
  });

  it("provider 未注册时 not-ready", async () => {
    const { agentConfig } = await setup();

    const result = notReadyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: {},
        refreshCatalog: async () => {},
      }),
    );

    expect(result.reasons).toContain("MODEL_UNAVAILABLE");
  });

  it("凭据不可用时 not-ready，注入运行时密钥后 ready", async () => {
    const { agentConfig } = await setup();

    const withoutKey = notReadyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: {},
        registerProviders: registerUnconfiguredProvider("deepseek-flash"),
        refreshCatalog: async () => {},
      }),
    );
    expect(withoutKey.reasons).toContain("MODEL_UNAVAILABLE");

    const withKey = readyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: { INSURANCE_AGENT_API_KEY: "sk-runtime-key" },
        registerProviders: registerUnconfiguredProvider("deepseek-flash"),
        refreshCatalog: async () => {},
      }),
    );
    expect(withKey.model.id).toBe("deepseek-flash");
  });

  it("刷新超时由 refreshCatalogWithTimeout 兜住", async () => {
    const hanging = {
      refresh: () => new Promise<never>(() => {}),
    } as unknown as ModelRuntime;

    await expect(refreshCatalogWithTimeout(hanging, 20)).rejects.toThrow();
  });
});

describe("配置隔离", () => {
  it("凭据只注入内存，不落盘到 runtime data 目录", async () => {
    const { agentConfig } = await setup();
    const secret = "sk-test-key-9f8e7d6c";

    readyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: { INSURANCE_AGENT_API_KEY: secret },
        registerProviders: registerFauxProvider("deepseek-flash"),
        refreshCatalog: async () => {},
      }),
    );

    // SDK 会创建空的凭据文件；关键是密钥不会落盘。
    const authPath = agentModelRuntimePaths(agentConfig).authPath;
    expect(existsSync(authPath)).toBe(true);
    expect(readFileSync(authPath, "utf8")).not.toContain(secret);
  });

  it("不回退读取开发机 Pi 凭据", async () => {
    const { workspace, agentConfig } = await setup();
    const developerKey = "sk-from-developer-home";
    await workspace.write(
      "polluted-home/.pi/agent/auth.json",
      JSON.stringify({ "opencode-go": { type: "api_key", key: developerKey } }),
    );

    await loadAgentModelRuntime(agentConfig, {
      env: { HOME: join(workspace.root, "polluted-home") },
      registerProviders: registerFauxProvider("deepseek-flash"),
      refreshCatalog: async () => {},
    });

    const authPath = agentModelRuntimePaths(agentConfig).authPath;
    expect(readFileSync(authPath, "utf8")).not.toContain(developerKey);
  });

  it("污染开发机 HOME 与 Pi 全局配置不会改变模型解析结果", async () => {
    const { workspace, agentConfig } = await setup();
    const clean = readyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: { HOME: join(workspace.root, "clean-home") },
        registerProviders: registerFauxProvider("deepseek-flash"),
        refreshCatalog: async () => {},
      }),
    );
    const cleanProviders = clean.modelRuntime
      .getProviders()
      .map((provider) => provider.id)
      .sort();

    await workspace.write(
      "polluted-home/.pi/agent/models.json",
      JSON.stringify({
        providers: {
          "polluted-provider": { models: [{ id: "polluted-model" }] },
        },
      }),
    );
    await workspace.write(
      "polluted-home/.pi/agent/settings.json",
      JSON.stringify({ defaultTools: ["bash"] }),
    );

    const polluted = readyResult(
      await loadAgentModelRuntime(agentConfig, {
        env: {
          HOME: join(workspace.root, "polluted-home"),
          PI_CONFIG_DIR: join(workspace.root, "polluted-home", ".pi"),
        },
        registerProviders: registerFauxProvider("deepseek-flash"),
        refreshCatalog: async () => {},
      }),
    );

    expect(polluted.model.id).toBe("deepseek-flash");
    expect(
      polluted.modelRuntime
        .getProviders()
        .map((provider) => provider.id)
        .sort(),
    ).toEqual(cleanProviders);
    expect(
      polluted.modelRuntime.getModel("polluted-provider", "polluted-model"),
    ).toBeUndefined();
  });
});
