import { join } from "node:path";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  loadAgentResources,
  type AgentResourceLoaderResult,
} from "../../src/runtime/agent_resources.js";

const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
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

/** 生成带 frontmatter 的 SKILL.md 内容。 */
function skillFile(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n正文内容。\n`;
}

/** 断言资源加载 ready 并收窄类型。 */
function ready(
  result: AgentResourceLoaderResult,
): Extract<AgentResourceLoaderResult, { status: "ready" }> {
  if (result.status !== "ready") throw new Error("预期资源加载 ready");
  return result;
}

/** 断言资源加载 not-ready 并收窄类型。 */
function notReady(
  result: AgentResourceLoaderResult,
): Extract<AgentResourceLoaderResult, { status: "not-ready" }> {
  if (result.status !== "not-ready") throw new Error("预期资源加载 not-ready");
  return result;
}

/** 读取已加载 skill 名称并排序。 */
function skillNames(result: AgentResourceLoaderResult): string[] {
  return ready(result)
    .resourceLoader.getSkills()
    .skills.map((skill) => skill.name)
    .sort();
}

describe("显式 allowlist 资源加载", () => {
  it("加载配置声明的 skill 目录", async () => {
    const base = defaultTestConfig();
    const { workspace } = await setup({
      ...base,
      resources: { skillPaths: ["agent-skills"], contextPaths: [] },
    });
    await workspace.write(
      "agent-skills/demo-skill/SKILL.md",
      skillFile("demo-skill", "示例技能"),
    );

    const result = await loadAgentResources(
      loadAgentConfig({ configPath: workspace.configPath, env: {} }),
    );

    expect(skillNames(result)).toEqual(["demo-skill"]);
  });

  it("把配置的上下文文件注入 agentsFiles", async () => {
    const base = defaultTestConfig();
    const { workspace } = await setup({
      ...base,
      resources: { skillPaths: [], contextPaths: ["agent-context.md"] },
    });
    const contextPath = await workspace.write(
      "agent-context.md",
      "续保助手上下文。\n",
    );

    const result = ready(
      await loadAgentResources(
        loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      ),
    );

    const agentsFiles = result.resourceLoader.getAgentsFiles().agentsFiles;
    expect(agentsFiles.map((file) => file.path)).toContain(contextPath);
    expect(
      agentsFiles.find((file) => file.path === contextPath)?.content,
    ).toContain("续保助手上下文");
  });

  it("服务内置 inline extension 在 noExtensions 下仍被加载", async () => {
    const { workspace } = await setup();
    let factoryCalled = false;
    const inlineExtension: InlineExtension = (pi) => {
      factoryCalled = true;
      pi.on("session_start", () => {});
    };

    ready(
      await loadAgentResources(
        loadAgentConfig({ configPath: workspace.configPath, env: {} }),
        {
          extensionFactories: [inlineExtension],
        },
      ),
    );

    expect(factoryCalled).toBe(true);
  });
});

describe("ambient 发现被关闭", () => {
  it("不加载工作目录中的 .agents/skills 与 .pi/settings.json 声明", async () => {
    const base = defaultTestConfig();
    const { workspace } = await setup({
      ...base,
      resources: { skillPaths: [], contextPaths: [] },
    });
    await workspace.write(
      "work/.agents/skills/ambient-skill/SKILL.md",
      skillFile("ambient-skill", "不应被加载"),
    );
    await workspace.write(
      "work/.pi/settings.json",
      JSON.stringify({ skills: ["work/.agents/skills/ambient-skill"] }),
    );

    const result = await loadAgentResources(
      loadAgentConfig({ configPath: workspace.configPath, env: {} }),
    );

    expect(skillNames(result)).toEqual([]);
  });

  it("不读取污染 HOME 中的 skills、extensions 与 settings", async () => {
    const { workspace, agentConfig } = await setup();
    const pollutedHome = join(workspace.root, "polluted-home");
    await workspace.write(
      "polluted-home/.pi/agent/skills/evil-skill/SKILL.md",
      skillFile("evil-skill", "来自开发机 HOME"),
    );
    await workspace.write(
      "polluted-home/.pi/agent/extensions/evil-extension.js",
      "export default () => {};\n",
    );
    await workspace.write(
      "polluted-home/.pi/agent/settings.json",
      JSON.stringify({
        skills: ["polluted-home/.pi/agent/skills/evil-skill"],
        defaultTools: ["bash"],
      }),
    );
    vi.stubEnv("HOME", pollutedHome);
    vi.stubEnv("PI_CONFIG_DIR", join(pollutedHome, ".pi"));

    const result = await loadAgentResources(agentConfig);

    expect(skillNames(result)).toEqual([]);
    expect(ready(result).resourceLoader.getExtensions().extensions).toEqual([]);
  });
});

describe("资源缺失导致 not-ready", () => {
  it("配置的上下文文件不存在时 not-ready", async () => {
    const base = defaultTestConfig();
    const { workspace } = await setup({
      ...base,
      resources: { skillPaths: [], contextPaths: ["missing-context.md"] },
    });

    const result = notReady(
      await loadAgentResources(
        loadAgentConfig({ configPath: workspace.configPath, env: {} }),
      ),
    );

    expect(result.reasons).toContain("RESOURCES_INVALID");
    expect(result.warnings.join(" ")).toContain("missing-context.md");
  });

  it("未声明的 skill 目录不会被自动发现", async () => {
    const { workspace, agentConfig } = await setup();
    await workspace.write(
      "unlisted-skill/SKILL.md",
      skillFile("unlisted-skill", "未声明"),
    );

    const result = await loadAgentResources(agentConfig);

    expect(skillNames(result)).toEqual([]);
  });
});
