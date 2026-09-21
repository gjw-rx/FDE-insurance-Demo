import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTempWorkspace,
  defaultTestConfig,
  type TempWorkspace,
} from "../support/workspace.js";
import {
  AgentConfigError,
  loadAgentConfig,
  type AgentConfigErrorCode,
} from "../../src/config/agent_config.js";

const workspaces: TempWorkspace[] = [];

/** 创建临时 workspace 并在用例结束后统一清理。 */
async function tempWorkspace(
  config: unknown = defaultTestConfig(),
): Promise<TempWorkspace> {
  const workspace = await createTempWorkspace(config);
  workspaces.push(workspace);
  return workspace;
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => workspace.cleanup()),
  );
});

/** 捕获并断言抛出的 AgentConfigError。 */
function captureError(action: () => unknown): AgentConfigError {
  try {
    action();
  } catch (error) {
    if (error instanceof AgentConfigError) return error;
    throw error;
  }
  throw new Error("预期抛出 AgentConfigError，但没有抛出");
}

/** 断言配置加载被拒绝，并校验错误码与字段路径。 */
function expectRejected(
  action: () => unknown,
  code: AgentConfigErrorCode,
  field?: string,
): AgentConfigError {
  const error = captureError(action);
  expect(error.code).toBe(code);
  if (field !== undefined) expect(error.field).toBe(field);
  return error;
}

describe("仓库默认配置", () => {
  it("使用仓库默认配置启动", () => {
    const config = loadAgentConfig({ env: {} });

    expect(config.agentName).toBe("insurance-agent");
    expect(config.model).toEqual({
      provider: "opencode-go",
      id: "deepseek-v4.1-flash",
      thinkingLevel: "high",
      apiKeyEnv: "INSURANCE_AGENT_API_KEY",
      catalogRefreshTimeoutMs: 15_000,
    });
    expect(config.tools).toEqual(["read", "grep", "find", "ls"]);
    expect(config.workingDirectory).toBe(config.repositoryRoot);
    expect(config.runtime.dataDirectory).toBe(
      join(config.repositoryRoot, ".runtime", "insurance-agent"),
    );
    expect(config.http).toEqual({ host: "127.0.0.1", port: 4310 });
  });

  it("环境变量只用于定位配置和密钥变量名，不改变配置值", () => {
    const fromEnvironment = loadAgentConfig({ env: {} });
    const withExtraEnvironment = loadAgentConfig({
      env: {
        HOME: "/polluted-home",
        INSURANCE_AGENT_API_KEY: "sk-live-should-not-be-read-from-config",
        PI_CONFIG_DIR: "/polluted-pi",
      },
    });

    expect(withExtraEnvironment).toEqual(fromEnvironment);
  });
});

describe("路径解析", () => {
  it("相对路径以仓库根为基准", async () => {
    const workspace = await tempWorkspace();
    const config = loadAgentConfig({
      configPath: workspace.configPath,
      env: {},
    });

    expect(config.repositoryRoot).toBe(workspace.root);
    expect(config.workingDirectory).toBe(workspace.workDirectory);
    expect(config.runtime.dataDirectory).toBe(
      join(workspace.root, ".runtime", "insurance-agent"),
    );
  });

  it("资源路径解析为仓库根下的绝对路径", async () => {
    const base = defaultTestConfig();
    const workspace = await tempWorkspace({
      ...base,
      resources: {
        skillPaths: ["agent-skills"],
        contextPaths: ["docs/agent-context.md"],
      },
    });

    const config = loadAgentConfig({
      configPath: workspace.configPath,
      env: {},
    });

    expect(config.resources.skillPaths).toEqual([
      join(workspace.root, "agent-skills"),
    ]);
    expect(config.resources.contextPaths).toEqual([
      join(workspace.root, "docs", "agent-context.md"),
    ]);
  });

  it("INSURANCE_AGENT_CONFIG_PATH 指向环境专属配置", async () => {
    const workspace = await tempWorkspace();
    const config = loadAgentConfig({
      env: { INSURANCE_AGENT_CONFIG_PATH: workspace.configPath },
    });

    expect(config.configPath).toBe(workspace.configPath);
  });

  it("配置文件不存在时拒绝启动", async () => {
    const workspace = await tempWorkspace();
    expectRejected(
      () =>
        loadAgentConfig({
          configPath: join(workspace.root, "config", "missing.json"),
          env: {},
        }),
      "config-not-found",
    );
  });

  it("配置文件不是合法 JSON 时拒绝启动", async () => {
    const workspace = await tempWorkspace();
    await workspace.write("config/insurance-agent.json", "{ this is not json");

    expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-invalid",
    );
  });
});

describe("明文凭据", () => {
  it("拒绝模型密钥字段且不在错误信息中回显密钥", async () => {
    const base = defaultTestConfig();
    const secretValue = "sk-live-9f8e7d6c5b4a";
    const workspace = await tempWorkspace({
      ...base,
      model: { ...base.model, apiKey: secretValue },
    });

    const error = expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-plaintext-secret",
      "model.apiKey",
    );

    expect(error.message).not.toContain(secretValue);
  });

  it("拒绝嵌套的 token 与 secret 字段", async () => {
    const base = defaultTestConfig();
    const workspace = await tempWorkspace({
      ...base,
      http: { ...base.http, token: "bearer-abc" },
    });

    const error = expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-plaintext-secret",
      "http.token",
    );
    expect(error.message).not.toContain("bearer-abc");
  });

  it("允许只保存变量名的 apiKeyEnv", async () => {
    const workspace = await tempWorkspace();
    const config = loadAgentConfig({
      configPath: workspace.configPath,
      env: {},
    });
    expect(config.model.apiKeyEnv).toBe("INSURANCE_AGENT_API_KEY");
  });
});

describe("必填与非法配置", () => {
  it("拒绝未知顶层字段", async () => {
    const workspace = await tempWorkspace({
      ...defaultTestConfig(),
      mcp: { servers: [] },
    });
    expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-unknown-field",
      "mcp",
    );
  });

  it("拒绝未知嵌套字段", async () => {
    const base = defaultTestConfig();
    const workspace = await tempWorkspace({
      ...base,
      runtime: { ...base.runtime, maxRuns: 2 },
    });
    expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-unknown-field",
      "runtime.maxRuns",
    );
  });

  it("拒绝缺失的必填字段并定位到具体字段", async () => {
    const base = defaultTestConfig();
    const { id: _ignored, ...modelWithoutId } = base.model;
    const workspace = await tempWorkspace({ ...base, model: modelWithoutId });

    expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-invalid",
      "model.id",
    );
  });

  it("拒绝非法 thinking level", async () => {
    const base = defaultTestConfig();
    const workspace = await tempWorkspace({
      ...base,
      model: { ...base.model, thinkingLevel: "highest" },
    });

    expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-invalid",
      "model.thinkingLevel",
    );
  });

  it("拒绝非法 agent 名称", async () => {
    const base = defaultTestConfig();
    const workspace = await tempWorkspace({
      ...base,
      agent: { ...base.agent, name: "Insurance Agent" },
    });

    expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-invalid",
      "agent.name",
    );
  });

  it("拒绝越界的数值参数", async () => {
    const base = defaultTestConfig();
    const workspace = await tempWorkspace({
      ...base,
      runtime: { ...base.runtime, maxConcurrentRuns: 0 },
    });

    expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-invalid",
      "runtime.maxConcurrentRuns",
    );
  });

  it("拒绝非整数端口", async () => {
    const base = defaultTestConfig();
    const workspace = await tempWorkspace({
      ...base,
      http: { ...base.http, port: 4310.5 },
    });

    expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-invalid",
      "http.port",
    );
  });
});

describe("只读工具白名单", () => {
  it("拒绝 bash", async () => {
    const base = defaultTestConfig();
    const workspace = await tempWorkspace({
      ...base,
      tools: { allow: ["read", "bash"] },
    });

    const error = expectRejected(
      () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      "config-invalid",
      "tools.allow[1]",
    );
    expect(error.message).toContain("bash");
  });

  it("拒绝 edit 与 write", async () => {
    const base = defaultTestConfig();
    for (const forbidden of ["edit", "write"]) {
      const workspace = await tempWorkspace({
        ...base,
        tools: { allow: [forbidden] },
      });
      expectRejected(
        () => loadAgentConfig({ configPath: workspace.configPath, env: {} }),
        "config-invalid",
        "tools.allow[0]",
      );
    }
  });

  it("拒绝空工具列表与重复工具", async () => {
    const base = defaultTestConfig();

    const emptyWorkspace = await tempWorkspace({
      ...base,
      tools: { allow: [] },
    });
    expectRejected(
      () => loadAgentConfig({ configPath: emptyWorkspace.configPath, env: {} }),
      "config-invalid",
      "tools.allow",
    );

    const duplicateWorkspace = await tempWorkspace({
      ...base,
      tools: { allow: ["read", "read"] },
    });
    expectRejected(
      () =>
        loadAgentConfig({ configPath: duplicateWorkspace.configPath, env: {} }),
      "config-invalid",
      "tools.allow[1]",
    );
  });
});
